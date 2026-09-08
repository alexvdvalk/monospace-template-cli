#!/usr/bin/env bun
/**
 * Monospace quickstart CLI.
 *
 * Prompts for a target database, then a template, shows what it is about to do,
 * and applies the schema and sample data. Everything is deployed through code
 * (the `/schema/migrate` AST plus the items API) rather than by hand or via MCP,
 * with deterministic ids so a rerun converges on the same result.
 *
 *   bun run quickstart
 *   bun run quickstart --source=postgres --template=issue-tracker --yes
 *   bun run quickstart --dry-run
 */

import enquirer from 'enquirer';
import {
  ApiError,
  connect,
  credentials,
  listWorkspaces,
  preflight,
  type Api,
  type Credentials,
  type Workspace,
} from './lib/api.ts';
import { applyMeta, applySchema, planSchema, type Target } from './lib/apply-schema.ts';
import { applySeed } from './lib/apply-seed.ts';
import { readApiNames, readDataSources, readNamespaces, type DataSource, type Namespace } from './lib/introspect.ts';
import { findTemplate, templates } from './templates/index.ts';
import type { Template } from './lib/types.ts';

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

type Flags = {
  workspace?: string;
  source?: string;
  namespace?: string;
  template?: string;
  prefix?: string;
  yes: boolean;
  dryRun: boolean;
  schemaOnly: boolean;
  seedOnly: boolean;
};

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { yes: false, dryRun: false, schemaOnly: false, seedOnly: false };
  for (const arg of argv) {
    const [name, value] = arg.replace(/^--/, '').split('=');
    switch (name) {
      case 'workspace': flags.workspace = value; break;
      case 'source': flags.source = value; break;
      case 'namespace': flags.namespace = value; break;
      case 'template': flags.template = value; break;
      case 'prefix': flags.prefix = value; break;
      case 'yes': case 'y': flags.yes = true; break;
      case 'dry-run': flags.dryRun = true; break;
      case 'schema-only': flags.schemaOnly = true; break;
      case 'seed-only': flags.seedOnly = true; break;
      case 'help': case 'h': usage(); process.exit(0);
      default: throw new Error(`Unknown flag: ${arg}`);
    }
  }
  return flags;
}

function usage() {
  console.log(`${c.bold('monospace quickstart')} — apply a schema + sample-data template to a database

  ${c.dim('bun run quickstart')} [options]

  --workspace=<apiName>   target workspace (skips the prompt)
  --source=<apiName>      target data source (skips the prompt)
  --namespace=<dbName>    target namespace within the source
  --template=<id>         ${templates.map((t) => t.id).join(' | ')}
  --prefix=<Pascal>       prefix collection API names (for a second database)
  --yes                   skip the confirmation prompt
  --dry-run               print the plan, write nothing
  --schema-only           skip sample data
  --seed-only             skip schema changes
`);
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

async function select<T>(message: string, choices: { name: string; hint?: string; value: T }[]): Promise<T> {
  const answer = await enquirer.prompt<{ pick: string }>({
    type: 'select',
    name: 'pick',
    message,
    choices: choices.map((choice) => ({ name: choice.name, hint: choice.hint })),
  });
  return choices.find((choice) => choice.name === answer.pick)!.value;
}

async function chooseWorkspace(creds: Credentials, flags: Flags): Promise<Workspace> {
  const workspaces = await listWorkspaces(creds);
  if (workspaces.length === 0) throw new ApiError('This credential can see no workspaces.');

  const wanted = flags.workspace ?? creds.defaultWorkspace;
  if (wanted) {
    const match = workspaces.find((w) => w.apiName === wanted);
    if (match) return match;
    // An explicit --workspace that does not exist is an error; a stale default
    // in monospace.config.ts just falls through to the prompt.
    if (flags.workspace) {
      throw new ApiError(
        `No workspace named "${flags.workspace}". Available: ${workspaces.map((w) => w.apiName).join(', ')}`,
      );
    }
  }

  if (workspaces.length === 1) return workspaces[0]!;

  return select(
    'Workspace',
    workspaces.map((w) => ({
      name: w.apiName,
      hint: [w.displayName !== w.apiName ? w.displayName : null, w.apiName === creds.defaultWorkspace ? 'from monospace.config.ts' : null]
        .filter(Boolean)
        .join(' · ') || undefined,
      value: w,
    })),
  );
}

async function chooseSource(api: Api, flags: Flags): Promise<DataSource> {
  const sources = await readDataSources(api);
  if (sources.length === 0) throw new ApiError('No data sources in this workspace.');

  if (flags.source) {
    const match = sources.find((s) => s.apiName === flags.source);
    if (!match) {
      throw new ApiError(`No data source named "${flags.source}". Available: ${sources.map((s) => s.apiName).join(', ')}`);
    }
    return match;
  }

  return select(
    'Target database',
    sources.map((s) => ({
      name: s.apiName,
      hint: s.apiName === '_system' ? `${s.provider} · workspace data` : s.provider,
      value: s,
    })),
  );
}

async function chooseNamespace(api: Api, source: DataSource, flags: Flags): Promise<Namespace | null> {
  const namespaces = (await readNamespaces(api, source.id)).filter((n) => !n.isSystem);

  if (flags.namespace) {
    const match = namespaces.find((n) => n.dbName === flags.namespace);
    if (!match) throw new ApiError(`No namespace "${flags.namespace}" in ${source.apiName}.`);
    return match;
  }

  // An external database with no registered namespace lands in the connection's
  // own default schema, which is what a quickstart wants.
  if (namespaces.length === 0) return null;
  if (namespaces.length === 1) return namespaces[0]!;

  return select(
    `Namespace in ${source.apiName}`,
    namespaces.map((n) => ({ name: n.dbName, value: n })),
  );
}

async function chooseTemplate(flags: Flags): Promise<Template> {
  if (flags.template) {
    const match = findTemplate(flags.template);
    if (!match) throw new ApiError(`No template "${flags.template}". Available: ${templates.map((t) => t.id).join(', ')}`);
    return match;
  }
  if (templates.length === 1) return templates[0]!;
  return select('Template', templates.map((t) => ({ name: t.label, hint: t.summary, value: t })));
}

/**
 * API names are workspace-global. If another data source already owns one of the
 * template's names, this deployment needs a prefix — derived from the source
 * name so it stays the same on every rerun.
 */
async function derivePrefix(api: Api, source: DataSource, template: Template): Promise<string> {
  const owners = await readApiNames(api);
  const taken = template.collections.some((def) => {
    const owner = owners.get(def.apiName);
    return owner !== undefined && owner !== source.id;
  });
  if (!taken) return '';

  const prefix = source.apiName.replace(/[^a-zA-Z0-9]+(.)/g, (_, ch: string) => ch.toUpperCase());
  return prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const creds = credentials();
  await preflight(creds);

  console.log(`\n${c.bold('Monospace quickstart')} ${c.dim(`· ${creds.url}`)}\n`);

  // Workspace first: every other choice — data sources, namespaces, collections
  // — is scoped to one workspace.
  const workspace = await chooseWorkspace(creds, flags);
  const api = connect(workspace.apiName, creds);

  const source = await chooseSource(api, flags);
  const namespace = await chooseNamespace(api, source, flags);
  const template = await chooseTemplate(flags);

  const target: Target = {
    sourceId: source.id,
    namespaceId: namespace?.id ?? null,
    scope: `${source.apiName}/${namespace?.dbName ?? '_'}`,
    apiPrefix: flags.prefix ?? (await derivePrefix(api, source, template)),
  };
  const plan = await planSchema(api, template, target);
  const { rows, relinks } = template.seed();

  // --- summary -------------------------------------------------------------
  console.log(c.bold('Plan'));
  console.log(`  workspace  ${workspace.apiName}`);
  console.log(`  database   ${source.apiName} ${c.dim(`(${source.provider})`)}`);
  console.log(`  namespace  ${namespace?.dbName ?? c.dim('connection default')}`);
  console.log(`  template   ${template.label} ${c.dim(`(${template.id})`)}`);
  if (target.apiPrefix) {
    console.log(
      `  api names  ${target.apiPrefix}Xxx ${c.dim('— prefixed; another database in this workspace already owns the bare names')}`,
    );
  }
  console.log(`  mode       idempotent upsert ${c.dim('— creates what is missing, refreshes rows, drops nothing')}`);

  console.log(`\n${c.bold('Schema')}`);
  for (const action of plan.actions) {
    const verb = action.split(' ')[0]!;
    console.log(`  ${verb === 'create' ? c.green('+') : verb === 'update' ? c.yellow('~') : c.dim('=')} ${action}`);
  }
  if (plan.operations.length === 0) console.log(c.dim('  nothing to migrate'));

  if (!flags.schemaOnly) {
    console.log(`\n${c.bold('Sample data')}`);
    for (const key of template.seedOrder) {
      console.log(`  ${c.dim('·')} ${key}: ${rows[key]?.length ?? 0} rows`);
    }
    if (relinks.length > 0) console.log(`  ${c.dim('·')} ${relinks.length} parent links patched in afterwards`);
  }

  for (const warning of plan.warnings) console.log(`\n  ${c.yellow('!')} ${warning}`);

  if (flags.dryRun) {
    console.log(`\n${c.dim('--dry-run: nothing written.')}\n`);
    return;
  }

  if (!flags.yes) {
    const { go } = await enquirer.prompt<{ go: boolean }>({
      type: 'confirm',
      name: 'go',
      message: `Apply to ${workspace.apiName} / ${source.apiName}?`,
      initial: true,
    });
    if (!go) {
      console.log(c.dim('\nAborted.\n'));
      return;
    }
  }

  // --- apply ---------------------------------------------------------------
  console.log('');
  if (!flags.seedOnly) {
    process.stdout.write('  migrating schema … ');
    await applySchema(api, plan);
    console.log(c.green(`${plan.operations.length} operation(s)`));

    process.stdout.write('  writing display metadata … ');
    const written = await applyMeta(api, template, plan, target);
    console.log(c.green(`${written} row(s)`));
  }

  if (!flags.schemaOnly) {
    process.stdout.write('  seeding rows … ');
    const seeded = await applySeed(api, template, plan, rows, relinks);
    console.log(
      c.green(
        `${seeded.created} created, ${seeded.updated} updated, ${seeded.unchanged} unchanged, ${seeded.relinked} relinked`,
      ),
    );
    for (const line of seeded.perCollection) console.log(`      ${c.dim(line)}`);
  }

  console.log(`\n${c.green('Done.')} Open ${c.cyan(`${api.url}/${api.workspace}`)} to browse it.`);
  console.log(c.dim(`Regenerate typed SDK bindings for the new collections with: bunx @monospace/sdk generate\n`));
}

/**
 * Engine errors nest: the useful part (`meta.detail`, the offending field) sits
 * on an inner `source`, so a bare `error.message` reads as "Query failed".
 */
function explain(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const parts = [error.message];
  let node = error as unknown as Record<string, unknown>;
  while (node.source && typeof node.source === 'object') {
    node = node.source as Record<string, unknown>;
    if (typeof node.message === 'string' && node.message !== parts.at(-1)) parts.push(node.message);
    if (node.meta && typeof node.meta === 'object') parts.push(JSON.stringify(node.meta));
  }
  return parts.join('\n  ↳ ');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  // enquirer throws an empty string when the prompt is cancelled with Ctrl-C.
  if (message === '') {
    console.log(c.dim('\nCancelled.\n'));
    process.exit(130);
  }
  console.error(`\n${c.red('Failed:')} ${explain(error)}\n`);
  process.exit(1);
});

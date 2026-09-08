#!/usr/bin/env bun
/**
 * Dumps every row of a template's collections, sorted by id, as stable JSON.
 * Diffing two snapshots across a rerun is how the "identical results" claim is
 * checked:
 *
 *   bun run tools/snapshot.ts > /tmp/before.json
 *   bun run quickstart --source=postgres --yes
 *   bun run tools/snapshot.ts > /tmp/after.json
 *   diff /tmp/before.json /tmp/after.json
 *
 *   bun run tools/snapshot.ts issue-tracker Mysql   # prefixed deployment
 */

import { connect } from '../src/lib/api.ts';
import { snake, type Template } from '../src/lib/types.ts';
import { findTemplate, templates } from '../src/templates/index.ts';

const api = connect();
const template: Template = findTemplate(process.argv[2] ?? '') ?? templates[0]!;
const prefix = process.argv[3] ?? '';
const out: Record<string, unknown[]> = {};

for (const def of template.collections) {
  const fields = [
    ...def.fields.map((f) => f.name),
    ...(def.relations ?? []).map((r) => `${snake(r.name)}Id`.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase())),
  ];
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await api.client.$readMany<Record<string, unknown>>(prefix + def.apiName, {
      fields,
      sort: [{ id: { direction: 'asc' } }],
      limit: 100,
      offset,
    });
    rows.push(...page);
    if (page.length < 100) break;
  }
  out[def.key] = rows;
}

console.log(JSON.stringify(out, null, 1));

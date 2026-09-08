/**
 * Connection to the Monospace instance.
 *
 * Three surfaces are needed:
 *   - the generated typed SDK client, for reading the data model out of the
 *     system collections and for seed-row CRUD (`$readMany`, `$createMany`, …);
 *   - raw HTTP under `/api/<workspace>`, for the schema endpoints
 *     (`/schema/migrate`, `/schema/introspect`) which are engine routes rather
 *     than collections;
 *   - raw HTTP under `/api/system`, which is workspace-independent and is how
 *     the list of workspaces is discovered before one has been chosen.
 */

import { createClient } from '../generated/monospace/index.ts';
import rawConfig from '../../monospace.config.ts';
import type { Migration } from './types.ts';

/** `monospace.config.ts` is a union of remote/local shapes; we need the remote half. */
const config = rawConfig as { url?: string; workspace?: string };

export class ApiError extends Error {}

export type Credentials = {
  url: string;
  apiKey: string;
  /**
   * Default workspace when none is chosen: `MONOSPACE_WORKSPACE`, else
   * `monospace.config.ts`. The env var is how the `tools/` scripts target a
   * workspace other than the configured one.
   */
  defaultWorkspace: string | undefined;
};

export type Workspace = { id: string; apiName: string; displayName: string | null };

export type Api = {
  url: string;
  workspace: string;
  client: ReturnType<typeof createClient>;
  /** Apply a migration AST. Not idempotent — send only missing operations. */
  migrate: (migration: Migration) => Promise<void>;
  /** Diff a data source against its live database; returns catch-up operations. */
  introspect: (sourceId: string) => Promise<Migration>;
};

export function credentials(): Credentials {
  const url = (process.env.MONOSPACE_URL ?? config.url ?? '').replace(/\/$/, '');
  const apiKey = process.env.MONOSPACE_API_KEY;

  if (!url) throw new ApiError('No instance URL. Set MONOSPACE_URL in .env or `url` in monospace.config.ts.');
  if (!apiKey) throw new ApiError('No API key. Set MONOSPACE_API_KEY in .env (Studio → Account → Access → API Keys).');

  return { url, apiKey, defaultWorkspace: process.env.MONOSPACE_WORKSPACE ?? config.workspace };
}

/** Confirm the engine is reachable before doing anything else. */
export async function preflight(creds: Credentials = credentials()): Promise<void> {
  let status: number;
  try {
    status = (await fetch(`${creds.url}/ping`)).status;
  } catch (cause) {
    throw new ApiError(
      `Cannot reach a Monospace engine at ${creds.url}.\n` +
        `Start it with:\n  cd <quickstart repo>\n  docker compose up -d`,
      { cause },
    );
  }
  if (status !== 200) throw new ApiError(`${creds.url}/ping returned ${status}; expected 200.`);
}

/**
 * Workspaces the credential can see. Lives under `/api/system`, so it is
 * readable before a workspace has been picked.
 */
export async function listWorkspaces(creds: Credentials = credentials()): Promise<Workspace[]> {
  const query = ['id', 'apiName', 'displayName'].map((f) => `fields[]=${f}`).join('&');
  const res = await fetch(`${creds.url}/api/system/workspaces?${query}&limit=200`, {
    headers: { Authorization: `Bearer ${creds.apiKey}` },
  });
  const text = await res.text();
  if (!res.ok) throw new ApiError(`GET /api/system/workspaces → ${res.status}\n${text}`);

  const workspaces = (JSON.parse(text) as { data: Workspace[] }).data;
  return workspaces.sort((a, b) => a.apiName.localeCompare(b.apiName));
}

export function connect(workspace?: string, creds: Credentials = credentials()): Api {
  const target = workspace ?? creds.defaultWorkspace;
  if (!target) {
    throw new ApiError('No workspace. Pass --workspace=<apiName> or set `workspace` in monospace.config.ts.');
  }

  const request = async <T>(path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${creds.url}/api/${target}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.apiKey}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    if (!res.ok) throw new ApiError(`POST ${path} → ${res.status}\n${text}`);
    return (text ? JSON.parse(text) : undefined) as T;
  };

  return {
    url: creds.url,
    workspace: target,
    client: createClient({ url: creds.url, workspace: target, apiKey: creds.apiKey }),
    migrate: async (migration) => {
      if (migration.operations.length === 0) return;
      await request('/schema/migrate', migration);
    },
    introspect: async (sourceId) => {
      const res = await request<{ data: Migration }>(`/schema/introspect/${sourceId}`);
      return res.data;
    },
  };
}

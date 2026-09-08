/**
 * Reads the live data model out of Monospace's system collections. This is the
 * "before" side of every diff: nothing is created without first checking what
 * the target database already has.
 */

import type { Api } from './api.ts';
import type { Uuid } from '../generated/monospace/index.ts';

export type DataSource = { id: Uuid; apiName: string; provider: string };
export type Namespace = { id: Uuid; dbName: string; sourceId: Uuid; isSystem: boolean };

export type LiveField = { id: Uuid; apiName: string; dbName: string; type: unknown; isNullable: boolean };
export type LiveIndex = { id: Uuid; dbName: string; kind: string };
export type LiveRelation = { id: Uuid; apiName: string; isList: boolean };

export type LiveCollection = {
  id: Uuid;
  apiName: string;
  dbName: string;
  sourceId: Uuid;
  namespaceId: Uuid | null;
  fields: Map<string, LiveField>;
  indexes: Map<string, LiveIndex>;
  relations: Map<string, LiveRelation>;
};

export async function readDataSources(api: Api): Promise<DataSource[]> {
  const rows = await api.client.MonospaceDataSource.readMany({
    fields: ['id', 'apiName', 'provider'],
    sort: [{ apiName: { direction: 'asc' } }],
    limit: 200,
  });
  return rows as DataSource[];
}

export async function readNamespaces(api: Api, sourceId: Uuid): Promise<Namespace[]> {
  const rows = await api.client.MonospaceNamespace.readMany({
    fields: ['id', 'dbName', 'sourceId', 'isSystem'],
    filter: { sourceId: { _eq: sourceId } },
    sort: [{ dbName: { direction: 'asc' } }],
    limit: 200,
  });
  return rows as Namespace[];
}

/**
 * Existing collections in one data source, keyed by dbName. Relations are keyed
 * by apiName so a template relation can be matched without guessing its id.
 */
/** Every non-system collection's API name in the workspace, mapped to its source. */
export async function readApiNames(api: Api): Promise<Map<string, Uuid>> {
  const rows = await api.client.MonospaceCollection.readMany({
    fields: ['apiName', 'sourceId'],
    filter: { isSystem: { _eq: false } },
    limit: 500,
  });
  return new Map((rows as { apiName: string; sourceId: Uuid }[]).map((r) => [r.apiName, r.sourceId]));
}

export async function readCollections(api: Api, sourceId: Uuid): Promise<Map<string, LiveCollection>> {
  const rows = await api.client.MonospaceCollection.readMany({
    fields: [
      'id',
      'apiName',
      'dbName',
      'sourceId',
      'namespaceId',
      { primitiveFields: { fields: ['id', 'apiName', 'dbName', 'type', 'isNullable'], limit: 500 } },
      { indexes: { fields: ['id', 'dbName', 'kind'], limit: 500 } },
      { relationFields: { fields: ['id', 'apiName', 'isList'], limit: 500 } },
    ],
    filter: { sourceId: { _eq: sourceId }, isSystem: { _eq: false } },
    limit: 500,
  });

  const out = new Map<string, LiveCollection>();
  for (const row of rows as unknown as RawCollection[]) {
    out.set(row.dbName, {
      id: row.id,
      apiName: row.apiName,
      dbName: row.dbName,
      sourceId: row.sourceId,
      namespaceId: row.namespaceId,
      fields: index(row.primitiveFields?.data ?? [], (f) => f.dbName),
      indexes: index(row.indexes?.data ?? [], (i) => i.dbName),
      relations: index(row.relationFields?.data ?? [], (r) => r.apiName),
    });
  }
  return out;
}

type RawCollection = {
  id: Uuid;
  apiName: string;
  dbName: string;
  sourceId: Uuid;
  namespaceId: Uuid | null;
  // to-many relations come back enveloped; the SDK only unwraps the top level
  primitiveFields?: { data: LiveField[] };
  indexes?: { data: LiveIndex[] };
  relationFields?: { data: LiveRelation[] };
};

function index<T>(items: T[], key: (item: T) => string): Map<string, T> {
  return new Map(items.map((item) => [key(item), item]));
}

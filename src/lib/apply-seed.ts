/**
 * Idempotent seed-row writes.
 *
 * The items API has no upsert: POSTing a row whose primary key already exists
 * fails on the unique constraint. Since seed ids are deterministic, a rerun can
 * read back what is already there and split the batch three ways — create,
 * patch, leave alone.
 *
 * Rows that already match are skipped, which is what keeps a large template
 * practical: patching every row one at a time is a request per row, so a 20k-row
 * catalogue would take thousands of round trips to tell you nothing changed.
 * Reads are batched, so the same check costs one request per 100 rows.
 *
 * Three traps:
 *   - a column backing a relation is not directly writable. `productId` is
 *     rejected; the write has to go through the relation as
 *     `product: { _connect: { key: { id } } }`, which is what templates emit;
 *   - on PATCH the same relation expects a *list* of operations
 *     (`product: [{ _connect: … }]`), so create-shaped rows are rewritten
 *     before being sent as an update;
 *   - values do not round-trip verbatim. A timestamp written as
 *     `2026-01-15T09:00:00.000Z` reads back as `2026-01-15T09:00:00Z`, and a
 *     decimal written as a number reads back as a string. Comparison is
 *     therefore per-type, not `===`.
 */

import type { Api } from './api.ts';
import type { SchemaPlan } from './apply-schema.ts';
import type { CollectionDef, PrimitiveType, Relink, SeedRows, Template } from './types.ts';

/** The engine's default page size; also a comfortable read/write batch. */
const BATCH = 100;

export type SeedResult = {
  created: number;
  updated: number;
  unchanged: number;
  relinked: number;
  perCollection: string[];
};

export async function applySeed(
  api: Api,
  template: Template,
  plan: SchemaPlan,
  rows: SeedRows,
  relinks: Relink[] = [],
): Promise<SeedResult> {
  const result: SeedResult = { created: 0, updated: 0, unchanged: 0, relinked: 0, perCollection: [] };

  for (const key of template.seedOrder) {
    const collection = plan.apiNames.get(key);
    const def = template.collections.find((c) => c.key === key);
    const batch = rows[key] ?? [];
    if (!collection || !def || batch.length === 0) continue;

    const counts = { created: 0, updated: 0, unchanged: 0 };

    for (let offset = 0; offset < batch.length; offset += BATCH) {
      const slice = batch.slice(offset, offset + BATCH);
      const existing = new Map(
        (
          await api.client.$readMany<Record<string, unknown>>(collection, {
            fields: readableFields(def),
            filter: { id: { _in: slice.map((row) => row.id as string) } },
            limit: BATCH,
          })
        ).map((row) => [row.id as string, row]),
      );

      const fresh = slice.filter((row) => !existing.has(row.id as string));
      if (fresh.length > 0) {
        await api.client.$createMany(collection, { data: fresh, fields: ['id'] });
        counts.created += fresh.length;
      }

      for (const row of slice) {
        const live = existing.get(row.id as string);
        if (!live) continue;
        if (matches(def, row, live)) {
          counts.unchanged += 1;
          continue;
        }
        const { id, ...rest } = row;
        await api.client.$updateOne(collection, { key: id as string, data: forUpdate(rest), fields: ['id'] });
        counts.updated += 1;
      }
    }

    result.created += counts.created;
    result.updated += counts.updated;
    result.unchanged += counts.unchanged;
    result.perCollection.push(
      `${key}: ${counts.created} created, ${counts.updated} updated, ${counts.unchanged} unchanged`,
    );
  }

  // Self-relations are patched last: a foreign key cannot point at a row
  // inserted in the same batch. Same read-first treatment as the rows above, so
  // a rerun does not repeat every patch.
  for (const [key, group] of groupBy(relinks, (relink) => relink.collection)) {
    const collection = plan.apiNames.get(key);
    if (!collection) continue;
    const columns = [...new Set(group.flatMap((relink) => Object.keys(relink.data).map((name) => `${name}Id`)))];

    for (let offset = 0; offset < group.length; offset += BATCH) {
      const slice = group.slice(offset, offset + BATCH);
      const live = new Map(
        (
          await api.client.$readMany<Record<string, unknown>>(collection, {
            fields: ['id', ...columns],
            filter: { id: { _in: slice.map((relink) => relink.id) } },
            limit: BATCH,
          })
        ).map((row) => [row.id as string, row]),
      );

      for (const relink of slice) {
        const current = live.get(relink.id);
        const settled =
          current !== undefined &&
          Object.entries(relink.data).every(([name, value]) => connectedId(value) === (current[`${name}Id`] ?? null));
        if (settled) continue;
        await api.client.$updateOne(collection, { key: relink.id, data: forUpdate(relink.data), fields: ['id'] });
        result.relinked += 1;
      }
    }
  }

  return result;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const group = out.get(key(item));
    if (group) group.push(item);
    else out.set(key(item), [item]);
  }
  return out;
}

/** Everything a seed row can set: primitive fields plus each relation's FK column. */
function readableFields(def: CollectionDef): string[] {
  return [...def.fields.map((f) => f.name), ...(def.relations ?? []).map((r) => `${r.name}Id`)];
}

/** True when the live row already carries every value the seed row would write. */
function matches(def: CollectionDef, desired: Record<string, unknown>, live: Record<string, unknown>): boolean {
  for (const field of def.fields) {
    if (!(field.name in desired)) continue;
    if (!sameValue(desired[field.name], live[field.name], field.type)) return false;
  }
  for (const relation of def.relations ?? []) {
    const target = desired[relation.name];
    const wanted = connectedId(target);
    // A relation the seed row omits is left as-is rather than forced to null.
    if (wanted === undefined) continue;
    if (wanted !== (live[`${relation.name}Id`] ?? null)) return false;
  }
  return true;
}

function connectedId(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const connect = (value as { _connect?: { key?: { id?: string } } })._connect;
  return connect?.key?.id ?? undefined;
}

function sameValue(desired: unknown, live: unknown, type: PrimitiveType): boolean {
  if (desired === undefined) return true;
  if (desired === null || live === null || live === undefined) return (desired ?? null) === (live ?? null);

  switch (type.name) {
    // Written with millisecond precision, read back without it.
    case 'dateTime':
    case 'dateTimeWithTimezone':
      return Date.parse(String(desired)) === Date.parse(String(live));
    // Written as a number, read back as a string to preserve precision.
    case 'decimal':
    case 'float32':
    case 'float64':
      return Number(desired) === Number(live);
    default:
      return desired === live;
  }
}

/** Rewrite create-shaped relation values into the list form PATCH expects. */
function forUpdate(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value && typeof value === 'object' && '_connect' in value ? [value] : value,
    ]),
  );
}

/** Row counts without writing anything — used by the plan summary. */
export function seedCounts(rows: SeedRows): string[] {
  return Object.entries(rows).map(([key, list]) => `${key}: ${list.length}`);
}

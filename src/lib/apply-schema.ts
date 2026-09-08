/**
 * Turns a template's declarative collections into a migration AST, sending only
 * the operations the target database is missing.
 *
 * `POST /schema/migrate` is *not* idempotent — re-sending a `createCollection`
 * for an existing collection is a 500. So every run diffs against the live
 * model first (see `introspect.ts`) and emits the difference. That, plus ids
 * derived deterministically from the template, is what makes a rerun converge
 * on the same result instead of failing or duplicating.
 */

import type { Api } from './api.ts';
import { id } from './ids.ts';
import { readCollections, type LiveCollection } from './introspect.ts';
import {
  snake,
  T,
  type CollectionDef,
  type CreateIndexOp,
  type CreatePrimitiveFieldOp,
  type FieldDef,
  type MigrationOperation,
  type RelationDef,
  type Template,
} from './types.ts';
import type { Uuid } from '../generated/monospace/index.ts';

export type Target = {
  sourceId: Uuid;
  namespaceId: Uuid | null;
  /**
   * Stable, human-readable name for this target, e.g. `postgres/public`.
   *
   * Collection ids are workspace-global, so deriving them from the template
   * alone makes applying the same template to a second database collide. The
   * scope is part of every derived id. It uses names rather than uuids so two
   * instances configured the same way still derive the same ids.
   */
  scope: string;
  /**
   * Prepended to every collection's API name, e.g. `Mysql` → `MysqlIssue`.
   *
   * API names are workspace-global (they are the REST route and the generated
   * SDK delegate), so the same template applied to a second database in the
   * same workspace needs distinct ones. Empty for the first deployment.
   */
  apiPrefix: string;
};

export type SchemaPlan = {
  operations: MigrationOperation[];
  /** Template collection key → collection id, whether pre-existing or to-be-created. */
  collectionIds: Map<string, string>;
  /** Template collection key → API name to address it by (prefix applied). */
  apiNames: Map<string, string>;
  actions: string[];
  warnings: string[];
};

const asUuid = (value: string) => value as Uuid;

/** Column that backs a to-one relation, e.g. `project` → `project_id`. */
const fkColumn = (relation: RelationDef) => `${snake(relation.name)}_id`;

function fieldDbName(field: FieldDef) {
  return field.db ?? snake(field.name);
}

// ---------------------------------------------------------------------------
// Id derivation — every id is a pure function of the template
// ---------------------------------------------------------------------------

const ids = {
  collection: (scope: string, t: string, key: string) => id(scope, t, 'collection', key),
  field: (scope: string, t: string, key: string, column: string) => id(scope, t, 'field', key, column),
  index: (scope: string, t: string, key: string, name: string) => id(scope, t, 'index', key, name),
  relation: (scope: string, t: string, key: string, name: string) => id(scope, t, 'relation', key, name),
};

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export async function planSchema(api: Api, template: Template, target: Target): Promise<SchemaPlan> {
  const live = await readCollections(api, target.sourceId);
  const plan: SchemaPlan = { operations: [], collectionIds: new Map(), apiNames: new Map(), actions: [], warnings: [] };

  const inTarget = (collection: LiveCollection | undefined) =>
    collection && collection.namespaceId === target.namespaceId ? collection : undefined;

  // Pass A — collections, columns, indexes.
  for (const def of template.collections) {
    const existing = inTarget(live.get(def.key));
    // An existing collection keeps the API name it already has.
    plan.apiNames.set(def.key, existing?.apiName ?? target.apiPrefix + def.apiName);
    if (existing) {
      plan.collectionIds.set(def.key, existing.id);
      planExistingCollection(plan, template, def, existing, target.scope);
    } else {
      plan.collectionIds.set(def.key, ids.collection(target.scope, template.id, def.key));
      planNewCollection(plan, template, def, target);
    }
  }

  // Pass B — relation pairs, once every collection is guaranteed to exist.
  for (const def of template.collections) {
    for (const relation of def.relations ?? []) {
      planRelation(plan, template, def, relation, inTarget(live.get(def.key)), target.scope);
    }
  }

  return plan;
}

function columnOps(scope: string, template: Template, def: CollectionDef) {
  const fields: CreatePrimitiveFieldOp[] = [];
  const indexes: CreateIndexOp[] = [];

  for (const field of def.fields) {
    const column = fieldDbName(field);
    const fieldId = ids.field(scope, template.id, def.key, column);
    fields.push({
      kind: 'createPrimitiveField',
      data: {
        id: fieldId,
        dbName: column,
        apiName: field.name,
        type: field.type,
        isNullable: field.nullable ?? false,
        isList: false,
      },
    });
    if (field.primary) {
      indexes.push({
        kind: 'createIndex',
        data: {
          id: ids.index(scope, template.id, def.key, `${column}_primary`),
          dbName: `${def.key}_pkey`,
          kind: 'primary',
          fieldIds: [fieldId],
        },
      });
    }
    if (field.unique) {
      indexes.push({
        kind: 'createIndex',
        data: {
          id: ids.index(scope, template.id, def.key, `${column}_unique`),
          dbName: `${def.key}_${column}_unique`,
          kind: 'unique',
          fieldIds: [fieldId],
        },
      });
    }
  }

  // Foreign-key columns are implied by the relations, not declared by templates.
  for (const relation of def.relations ?? []) {
    const column = fkColumn(relation);
    fields.push({
      kind: 'createPrimitiveField',
      data: {
        id: ids.field(scope, template.id, def.key, column),
        dbName: column,
        apiName: `${relation.name}Id`,
        type: T.uuid,
        isNullable: relation.nullable ?? false,
        isList: false,
      },
    });
  }

  return { fields, indexes };
}

function planNewCollection(plan: SchemaPlan, template: Template, def: CollectionDef, target: Target) {
  const { fields, indexes } = columnOps(target.scope, template, def);
  plan.operations.push({
    kind: 'createCollection',
    data: {
      id: plan.collectionIds.get(def.key)!,
      sourceId: target.sourceId,
      dbName: def.key,
      apiName: plan.apiNames.get(def.key)!,
      namespaceId: target.namespaceId,
      operations: [...fields, ...indexes],
    },
  });
  plan.actions.push(`create collection ${def.key} (${fields.length} columns, ${indexes.length} indexes)`);
}

function planExistingCollection(
  plan: SchemaPlan,
  template: Template,
  def: CollectionDef,
  existing: LiveCollection,
  scope: string,
) {
  const { fields, indexes } = columnOps(scope, template, def);
  const missingFields = fields.filter((op) => !existing.fields.has(op.data.dbName));
  const missingIndexes = indexes.filter((op) => !existing.indexes.has(op.data.dbName));

  for (const op of fields) {
    const current = existing.fields.get(op.data.dbName);
    if (current && JSON.stringify(current.type) !== JSON.stringify(op.data.type)) {
      plan.warnings.push(
        `${def.key}.${op.data.dbName} exists as ${JSON.stringify(current.type)}, ` +
          `template wants ${JSON.stringify(op.data.type)} — left unchanged`,
      );
    }
  }

  if (missingFields.length + missingIndexes.length === 0) {
    plan.actions.push(`collection ${def.key} up to date`);
    return;
  }

  // Missing columns must exist before an index can reference them, and the
  // engine applies a collection's operations in order, so one op is enough.
  plan.operations.push({
    kind: 'updateCollection',
    data: { id: existing.id, operations: [...missingFields, ...missingIndexes] },
  });
  plan.actions.push(
    `update collection ${def.key} (+${missingFields.length} columns, +${missingIndexes.length} indexes)`,
  );
}

function planRelation(
  plan: SchemaPlan,
  template: Template,
  def: CollectionDef,
  relation: RelationDef,
  existing: LiveCollection | undefined,
  scope: string,
) {
  if (existing?.relations.has(relation.name)) {
    plan.actions.push(`relation ${def.key}.${relation.name} up to date`);
    return;
  }

  const target = template.collections.find((c) => c.key === relation.to);
  if (!target) {
    plan.warnings.push(`relation ${def.key}.${relation.name} points at unknown collection ${relation.to}`);
    return;
  }

  const targetPk = target.fields.find((f) => f.primary);
  if (!targetPk) {
    plan.warnings.push(`relation ${def.key}.${relation.name}: ${relation.to} has no primary key`);
    return;
  }

  const column = fkColumn(relation);
  plan.operations.push({
    kind: 'createRelationFieldPair',
    data: {
      kind: 'single',
      data: {
        relationName: `${def.key}_${snake(relation.name)}_fkey`,
        onDelete: relation.onDelete ?? (relation.nullable ? 'setNull' : 'cascade'),
        onUpdate: 'noAction',
        // Constrained side: holds the FK column.
        firstField: {
          id: ids.relation(scope, template.id, def.key, relation.name),
          apiName: relation.name,
          isList: false,
          isConstrained: true,
          collectionId: plan.collectionIds.get(def.key)!,
          fieldIds: [ids.field(scope, template.id, def.key, column)],
        },
        // Reverse side: the to-many list on the target collection.
        secondField: {
          id: ids.relation(scope, template.id, relation.to, relation.reverseName),
          apiName: relation.reverseName,
          isList: true,
          isConstrained: false,
          collectionId: plan.collectionIds.get(relation.to)!,
          fieldIds: [ids.field(scope, template.id, relation.to, fieldDbName(targetPk))],
        },
      },
    },
  });
  plan.actions.push(`create relation ${def.key}.${relation.name} → ${relation.to} (+${relation.to}.${relation.reverseName})`);
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export async function applySchema(api: Api, plan: SchemaPlan): Promise<void> {
  await api.migrate({ operations: plan.operations });
}

/**
 * Studio presentation (display names, icons, field order). Held in the `*Meta`
 * system collections rather than the migration AST, so it is written through
 * the items API after the structure lands.
 */
export async function applyMeta(
  api: Api,
  template: Template,
  plan: SchemaPlan,
  target: Target,
): Promise<number> {
  const live = await readCollections(api, target.sourceId);
  let written = 0;

  for (const def of template.collections) {
    const collectionId = plan.collectionIds.get(def.key);
    if (!collectionId) continue;

    written += await upsertMeta(api, 'MonospaceCollectionMeta', { collectionId: asUuid(collectionId) }, {
      collection: { _connect: { key: { id: asUuid(collectionId) } } },
      displayName: def.displayName,
      description: def.description ?? null,
      icon: def.icon ?? null,
      isHidden: false,
    });

    const collection = [...live.values()].find((c) => c.id === collectionId);
    if (!collection) continue;

    const labelled = [
      ...def.fields.map((f, i) => ({ column: fieldDbName(f), label: f.displayName ?? f.name, sort: i })),
      ...(def.relations ?? []).map((r, i) => ({
        column: fkColumn(r),
        label: r.displayName ?? r.name,
        sort: def.fields.length + i,
      })),
    ];

    for (const { column, label, sort } of labelled) {
      const field = collection.fields.get(column);
      if (!field) continue;
      written += await upsertMeta(api, 'MonospacePrimitiveFieldMeta', { fieldId: field.id }, {
        field: { _connect: { key: { id: field.id } } },
        displayName: label,
        sort: String(sort).padStart(4, '0'),
        isHidden: false,
      });
    }
  }

  return written;
}

/** Create the meta row, or patch it if one already exists for this object. */
async function upsertMeta(
  api: Api,
  collection: string,
  filter: Record<string, Uuid>,
  data: Record<string, unknown>,
): Promise<number> {
  const [key, value] = Object.entries(filter)[0]!;
  const existing = await api.client.$readMany(collection, {
    fields: [key],
    filter: { [key]: { _eq: value } },
    limit: 1,
  });

  if (existing.length > 0) {
    await api.client.$updateMany(collection, {
      filter: { [key]: { _eq: value } },
      data: withoutConnects(data),
      fields: [key],
    });
  } else {
    await api.client.$createMany(collection, { data: [data], fields: [key] });
  }
  return 1;
}

/** `_connect` is a create-time construct; a patch must not resend it. */
function withoutConnects(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => !(value && typeof value === 'object' && '_connect' in value)),
  );
}

/**
 * Template definition types, plus the subset of Monospace's migration AST
 * (`POST /api/<workspace>/schema/migrate`) that the applier emits.
 */

// ---------------------------------------------------------------------------
// Monospace primitive types (from the engine's OpenAPI `PrimitiveType` enum)
// ---------------------------------------------------------------------------

export type PrimitiveType =
  | { name: 'int8' | 'int16' | 'int32' | 'int64' }
  | { name: 'uint8' | 'uint16' | 'uint32' | 'uint64' }
  | { name: 'float32' | 'float64' }
  | { name: 'decimal'; params: { precision: number; scale: number } }
  | { name: 'string'; params: { length: 'unlimited' } | { length: 'fixed'; value: number } }
  | { name: 'uuid' }
  | { name: 'boolean' }
  | { name: 'date' }
  | { name: 'time' }
  | { name: 'dateTime' }
  | { name: 'dateTimeWithTimezone' }
  | { name: 'json' }
  | { name: 'bytes' }
  | { name: 'geometry' };

export const T = {
  uuid: { name: 'uuid' } as PrimitiveType,
  text: { name: 'string', params: { length: 'unlimited' } } as PrimitiveType,
  varchar: (value: number) => ({ name: 'string', params: { length: 'fixed', value } }) as PrimitiveType,
  decimal: (precision: number, scale: number) => ({ name: 'decimal', params: { precision, scale } }) as PrimitiveType,
  int: { name: 'int32' } as PrimitiveType,
  bool: { name: 'boolean' } as PrimitiveType,
  date: { name: 'date' } as PrimitiveType,
  timestamp: { name: 'dateTimeWithTimezone' } as PrimitiveType,
  json: { name: 'json' } as PrimitiveType,
} as const;

export type ReferentialAction = 'cascade' | 'restrict' | 'noAction' | 'setNull' | 'setDefault';
export type IndexKind = 'primary' | 'unique' | 'normal';

// ---------------------------------------------------------------------------
// Template definition
// ---------------------------------------------------------------------------

export type FieldDef = {
  /** camelCase API name, e.g. `storyPoints`. */
  name: string;
  /** snake_case column name. Defaults to snake_case(name). */
  db?: string;
  type: PrimitiveType;
  nullable?: boolean;
  unique?: boolean;
  /** Marks this field as the collection's primary key. Exactly one per collection. */
  primary?: boolean;
  displayName?: string;
  description?: string;
};

export type RelationDef = {
  /** to-one API name on this collection, e.g. `project`. */
  name: string;
  /** `key` of the target collection in the same template. */
  to: string;
  /** to-many API name created on the target collection, e.g. `issues`. */
  reverseName: string;
  nullable?: boolean;
  onDelete?: ReferentialAction;
  displayName?: string;
  description?: string;
};

export type CollectionDef = {
  /** Template-local key; also the table name. */
  key: string;
  /** API name used in URLs and the generated SDK, e.g. `Issue`. */
  apiName: string;
  displayName: string;
  icon?: string;
  description?: string;
  fields: FieldDef[];
  relations?: RelationDef[];
};

/** Rows for one collection, keyed by template-local collection key. */
export type SeedRows = Record<string, Record<string, unknown>[]>;

/**
 * A patch applied after all rows are inserted. Needed where a foreign key
 * points inside the same collection — a self-relation cannot be satisfied by a
 * row in the same insert batch.
 */
export type Relink = { collection: string; id: string; data: Record<string, unknown> };

export type Template = {
  /** CLI id, e.g. `issue-tracker`. Part of every derived uuid — never rename. */
  id: string;
  label: string;
  summary: string;
  collections: CollectionDef[];
  /** Collections in FK-safe insert order (keys). */
  seedOrder: string[];
  seed: () => { rows: SeedRows; relinks: Relink[] };
};

// ---------------------------------------------------------------------------
// Migration AST (only the operations the applier emits)
// ---------------------------------------------------------------------------

export type CreatePrimitiveFieldOp = {
  kind: 'createPrimitiveField';
  data: {
    id: string;
    dbName: string;
    apiName: string;
    type: PrimitiveType;
    isNullable: boolean;
    isList: boolean;
  };
};

export type CreateIndexOp = {
  kind: 'createIndex';
  data: { id: string; dbName: string; kind: IndexKind; fieldIds: string[] };
};

export type MigrationOperation =
  | {
      kind: 'createCollection';
      data: {
        id: string;
        sourceId: string;
        dbName: string;
        apiName: string;
        namespaceId: string | null;
        operations: (CreatePrimitiveFieldOp | CreateIndexOp)[];
      };
    }
  | {
      kind: 'updateCollection';
      data: { id: string; operations: (CreatePrimitiveFieldOp | CreateIndexOp)[] };
    }
  | {
      kind: 'createRelationFieldPair';
      data: {
        kind: 'single';
        data: {
          relationName: string;
          onDelete: ReferentialAction;
          onUpdate: ReferentialAction;
          firstField: RelationFieldSide;
          secondField: RelationFieldSide;
        };
      };
    };

export type RelationFieldSide = {
  id: string;
  apiName: string;
  isList: boolean;
  isConstrained: boolean;
  collectionId: string;
  fieldIds: string[];
};

export type Migration = { operations: MigrationOperation[] };

/** snake_case a camelCase identifier. */
export function snake(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

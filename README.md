# Monospace quickstart scripts

A CLI that applies a ready-made data model plus deterministic sample data to a
database inside a Monospace workspace, so a demo instance can be stood up (and
stood up again) in one command.

```bash
bun install
bun run quickstart
```

It prompts for a **workspace**, then a **target database**, then a **template**,
prints what it is about to do, and applies it after you confirm. Any prompt with
a single answer is skipped.

## Why this exists

Clicking a realistic data model together in the Studio is slow and produces a
slightly different result every time. This deploys the model **in code** — the
engine's migration AST plus the items API — with every id derived
deterministically from the template, so the same command against the same
database converges on the same rows and the same ids.

## Options

```
--workspace=<apiName>   target workspace (skips the prompt)
--source=<apiName>      target data source (skips the prompt)
--namespace=<dbName>    target namespace within the source
--template=<id>         issue-tracker
--prefix=<Pascal>       prefix collection API names (for a second database)
--yes                   skip the confirmation prompt
--dry-run               print the plan, write nothing
--schema-only           skip sample data
--seed-only             skip schema changes
```

Reruns are **idempotent upserts**: missing collections, columns, indexes and
relations are created, seed rows are refreshed, and nothing is ever dropped. A
column that already exists with a different type is reported and left alone.
Rows that already match are left untouched rather than patched, so a second run
over the 16k-row `commerce` template is a few hundred batched reads instead of
16k writes.

## Templates

| id | Collections | Seed rows |
| --- | --- | --- |
| `issue-tracker` | `members`, `issue_statuses`, `projects`, `sprints`, `issues`, `comments` | ~390 |
| `commerce` | `brands`, `categories`, `suppliers`, `products`, `product_variants`, `product_media`, `variant_attributes`, `customers`, `addresses`, `orders`, `order_lines`, `shipments`, `payments`, `refunds` | ~16,300 |

`issue-tracker` seeds 8 members, 6 statuses, 3 projects, 6 sprints, 120 issues
(including epics with child issues) and 250 comments.

`commerce` is a product catalogue joined to the order side that sells from it —
500 products, ~1400 variants, 400 customers, 2000 orders, ~4900 order lines,
plus shipments, payments and refunds. `order_lines.variant → product_variants`
is the join that makes catalogue-to-revenue queries possible; lines also keep
`skuSnapshot` and `nameSnapshot`, because a real line item records what was sold
at the time rather than whatever the catalogue says today. Products are
categorised by what they are, not at random, so merchandising queries return
sensible results.

## How schema deployment works

Monospace exposes its data model through system collections, but **writing those
rows is metadata-only — it does not create tables**. Real DDL goes through
`POST /api/<workspace>/schema/migrate` with a migration AST
(`createCollection` / `updateCollection` / `createRelationFieldPair` / …).
That endpoint is not idempotent, so every run first reads the live model out of
the system collections (`src/lib/introspect.ts`) and sends only the difference.

Studio presentation — display names, icons, field order — is not part of the
migration AST; it lives in the `*Meta` system collections and is written through
the items API after the structure lands.

## Layout

```
src/
  cli.ts                        prompts, plan summary, apply
  lib/
    api.ts                      connection: typed SDK client + schema endpoints
    ids.ts                      deterministic UUIDv5 derivation
    rng.ts                      seeded PRNG and fixed-epoch timestamps
    types.ts                    template definitions + migration AST
    introspect.ts               reads the live data model
    apply-schema.ts             diff → migration AST → apply, then metadata
    apply-seed.ts               idempotent row upserts
  templates/
    index.ts                    registry
    issue-tracker/{schema,seed}.ts
tools/
  snapshot.ts                   dump all rows as stable JSON (rerun diffing)
  teardown.ts                   remove a template from a source (never used by the CLI)
```

## Adding a template

Add a directory under `src/templates/`, export `collections` (see
`src/lib/types.ts` for `CollectionDef`) and a `seed()` returning rows keyed by
collection, then register it in `src/templates/index.ts`. Three rules keep reruns
identical:

- derive every id with `id(...)` from `src/lib/ids.ts` — never `crypto.randomUUID()`;
- take randomness and timestamps from `src/lib/rng.ts` — never `Math.random()`,
  `Date.now()`, or `new Date()`;
- derive a row's id from its **natural key** (SKU, order number, email), never
  from its position in the generated array. Position-based ids look equivalent
  but break the moment the generator is edited: adding one entry shifts every
  later index, so the next run tries to write an existing unique value under a
  new id and fails on the constraint.

Relations declare only the to-one side plus the name of the to-many list they
create on the other collection; the backing foreign-key column is derived. Write
relation values as `{ _connect: { key: { id } } }`, omit them entirely when null,
and use a `relink` for a self-relation — a foreign key cannot point at a row
inserted in the same batch. Send `decimal` values as fixed-scale strings
(`"1234.56"`); the engine rejects a JSON float for a decimal column.

## Configuration

`monospace.config.ts` holds the instance URL and the default workspace; `.env`
holds `MONOSPACE_URL` and `MONOSPACE_API_KEY` (Studio → Account → Access → API
Keys).

Workspace resolution, highest precedence first: `--workspace`, then
`MONOSPACE_WORKSPACE`, then `monospace.config.ts`. If none of those names a
workspace the credential can see, the CLI prompts. The `tools/` scripts have no
flags, so target a different workspace with the env var:

```bash
MONOSPACE_WORKSPACE=other bun run tools/snapshot.ts
```

After applying a template, regenerate the typed client so the new collections
are available as `client.Issue`, `client.Project`, …:

```bash
bunx @monospace/sdk generate
```

## Verifying a rerun really is identical

```bash
bun run tools/snapshot.ts commerce > /tmp/before.json
bun run quickstart --source=mysql --template=commerce --yes
bun run tools/snapshot.ts commerce > /tmp/after.json
diff /tmp/before.json /tmp/after.json    # expect no output
```

The apply itself should report `0 operations` migrated and every row
`unchanged`.

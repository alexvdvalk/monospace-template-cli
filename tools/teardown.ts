#!/usr/bin/env bun
/**
 * Removes a template's collections from a data source — the inverse of the CLI,
 * kept out of it deliberately: `bun run quickstart` never drops anything.
 *
 * Useful for resetting a demo instance or re-testing a template from scratch.
 * Relation pairs have to go before the collections they connect, or the engine
 * refuses the delete on its own foreign keys.
 *
 *   bun run tools/teardown.ts postgres [issue-tracker]
 */

import { connect } from '../src/lib/api.ts';
import { readCollections, readDataSources } from '../src/lib/introspect.ts';
import { findTemplate, templates } from '../src/templates/index.ts';

const [sourceName, templateId] = process.argv.slice(2);
if (!sourceName) {
  console.error('usage: bun run tools/teardown.ts <source apiName> [template id]');
  process.exit(1);
}

const api = connect();
const template = findTemplate(templateId ?? '') ?? templates[0]!;
const source = (await readDataSources(api)).find((s) => s.apiName === sourceName);
if (!source) {
  console.error(`No data source named "${sourceName}".`);
  process.exit(1);
}

const live = await readCollections(api, source.id);
const present = template.collections.filter((def) => live.has(def.key));
if (present.length === 0) {
  console.log(`Nothing to remove: ${template.id} is not deployed to ${sourceName}.`);
  process.exit(0);
}

// Relation pairs first, then collections in reverse dependency order.
const operations: Record<string, unknown>[] = [];
for (const def of template.collections) {
  const collection = live.get(def.key);
  if (!collection) continue;
  for (const relation of def.relations ?? []) {
    const first = collection.relations.get(relation.name);
    const second = live.get(relation.to)?.relations.get(relation.reverseName);
    if (first && second) {
      operations.push({
        kind: 'deleteRelationFieldPair',
        data: { firstFieldId: first.id, secondFieldId: second.id },
      });
    }
  }
}
for (const key of [...template.seedOrder].reverse()) {
  const collection = live.get(key);
  if (collection) operations.push({ kind: 'deleteCollection', data: { id: collection.id } });
}

await api.migrate({ operations } as never);
console.log(`Removed ${present.length} collection(s) of ${template.id} from ${sourceName}.`);

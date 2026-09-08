/** Template registry. Add new templates here; the CLI lists whatever is exported. */

import type { Template } from '../lib/types.ts';
import { collections as commerceCollections, seedOrder as commerceSeedOrder } from './commerce/schema.ts';
import { seed as commerceSeed } from './commerce/seed.ts';
import { collections as issueCollections, seedOrder as issueSeedOrder } from './issue-tracker/schema.ts';
import { seed as issueSeed } from './issue-tracker/seed.ts';

export const templates: Template[] = [
  {
    id: 'issue-tracker',
    label: 'Issue tracker',
    summary: 'Projects, sprints, issues, statuses, members, comments',
    collections: issueCollections,
    seedOrder: issueSeedOrder,
    seed: issueSeed,
  },
  {
    id: 'commerce',
    label: 'Commerce (PIM + orders)',
    summary: 'Product catalogue joined to customers, orders, shipments, payments',
    collections: commerceCollections,
    seedOrder: commerceSeedOrder,
    seed: commerceSeed,
  },
];

export function findTemplate(id: string): Template | undefined {
  return templates.find((t) => t.id === id);
}

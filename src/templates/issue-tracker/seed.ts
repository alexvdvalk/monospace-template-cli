/**
 * Deterministic sample data.
 *
 * Nothing here reads the clock or the system RNG: ids come from the template
 * path, values from a fixed-seed generator, timestamps from a fixed epoch. Two
 * runs on two machines produce the same 120 issues with the same keys, the same
 * assignees, and the same ids.
 *
 * Row ids derive from each row's **natural key** — an issue key, an email —
 * never from its position in the generated array. Position-based ids look
 * equivalent but are brittle: inserting one more epic shifts every later index,
 * so the next run tries to write an existing issue key under a new id and dies
 * on the unique constraint.
 */

import { id } from '../../lib/ids.ts';
import { day, rng, stamp } from '../../lib/rng.ts';
import type { Relink, SeedRows } from '../../lib/types.ts';

const TEMPLATE = 'issue-tracker';
const row = (collection: string, key: string) => id(TEMPLATE, 'row', collection, key);
const link = (rowId: string) => ({ _connect: { key: { id: rowId } } });
/**
 * A nullable relation must be omitted rather than sent as `null` — the engine
 * rejects `null` where it expects a connect operation. `undefined` keys drop out
 * when the body is serialised.
 */
const maybeLink = (rowId: string | null | undefined) => (rowId ? link(rowId) : undefined);

const MEMBERS = [
  ['Dara Okonjo', 'dara.okonjo'],
  ['Priya Raghunathan', 'priya.raghunathan'],
  ['Tomas Lindqvist', 'tomas.lindqvist'],
  ['Wei Chen', 'wei.chen'],
  ['Amara Blake', 'amara.blake'],
  ['Kenji Watanabe', 'kenji.watanabe'],
  ['Sofia Marchetti', 'sofia.marchetti'],
  ['Noor Haddad', 'noor.haddad'],
] as const;

const STATUSES = [
  ['Backlog', 'backlog'],
  ['Selected', 'backlog'],
  ['In progress', 'in_progress'],
  ['In review', 'in_progress'],
  ['Blocked', 'in_progress'],
  ['Done', 'done'],
] as const;

const PROJECTS = [
  ['PLT', 'Platform', 'Core services, data model, and background jobs.'],
  ['WEB', 'Web client', 'Customer-facing web application and design system.'],
  ['MOB', 'Mobile', 'iOS and Android clients sharing one sync layer.'],
] as const;

const TYPES = ['story', 'task', 'bug', 'epic'] as const;
const PRIORITIES = ['medium', 'high', 'low', 'urgent'] as const;
const POINTS = [1, 2, 3, 5, 8, 13] as const;

const VERBS = ['Add', 'Fix', 'Refactor', 'Document', 'Harden', 'Speed up', 'Simplify', 'Instrument', 'Migrate', 'Remove'];
const SUBJECTS = [
  'pagination on the activity feed',
  'the token refresh path',
  'bulk import validation',
  'the sprint burndown query',
  'webhook retry backoff',
  'avatar upload handling',
  'the audit log writer',
  'permission checks on exports',
  'search result ranking',
  'the onboarding checklist',
  'stale cache invalidation',
  'attachment virus scanning',
  'timezone handling in reports',
  'the notification digest job',
  'schema migration rollback',
];
const EPIC_SUBJECTS = [
  'Self-serve onboarding',
  'Reporting overhaul',
  'Offline-first sync',
  'Access control rework',
  'Performance budget',
  'Bulk data import',
];
const NOTES = [
  'Reproduced on staging — attaching the trace.',
  'Blocked until the migration lands.',
  'Agreed to split this; opening a follow-up.',
  'Numbers look good after the index change.',
  'This overlaps with the work in review.',
  'Can we scope this down to the happy path?',
  'Confirmed fixed in the latest build.',
  'Needs a design pass before we commit.',
  'Adding tests for the empty-state case.',
  'Rolled back — it regressed the nightly run.',
];

export function seed(): { rows: SeedRows; relinks: Relink[] } {
  const r = rng(0x51ee_d0001 % 0xffffffff);

  const members = MEMBERS.map(([name, handle], i) => ({
    id: row('members', handle),
    name,
    email: `${handle}@example.com`,
    avatarUrl: `https://i.pravatar.cc/128?u=${handle}`,
    createdAt: stamp(-200 + i * 7),
  }));

  const statuses = STATUSES.map(([name, category], i) => ({
    id: row('issue_statuses', name.toLowerCase().replace(/ /g, '-')),
    name,
    category,
    sort: (i + 1) * 10,
  }));

  const projects = PROJECTS.map(([key, name, description], i) => ({
    id: row('projects', key),
    key,
    name,
    description,
    createdAt: stamp(-180 + i * 21),
    lead: link(members[i * 2]!.id),
  }));

  // Two sprints per project: one finished, one running.
  const sprints = projects.flatMap((project, p) =>
    [0, 1].map((s) => {
      const start = -28 + s * 14;
      const name = `${PROJECTS[p]![0]} Sprint ${s + 1}`;
      return {
        id: row('sprints', name),
        name,
        startsAt: day(start),
        endsAt: day(start + 13),
        state: s === 0 ? 'completed' : 'active',
        project: link(project.id),
      };
    }),
  );

  // Epics first so every child has a parent that already exists.
  const issues: Record<string, unknown>[] = [];
  const relinks: Relink[] = [];
  const epicsByProject: string[][] = projects.map(() => []);
  const counters = projects.map(() => 0);

  EPIC_SUBJECTS.forEach((title, i) => {
    const p = i % projects.length;
    counters[p] = counters[p]! + 1;
    const key = `${PROJECTS[p]![0]}-${counters[p]}`;
    const issueId = row('issues', key);
    epicsByProject[p]!.push(issueId);
    issues.push({
      id: issueId,
      key,
      title,
      description: `Umbrella work for ${title.toLowerCase()}.`,
      type: 'epic',
      priority: 'high',
      storyPoints: null,
      createdAt: stamp(-120 + i * 3),
      dueDate: day(30 + i * 7),
      project: link(projects[p]!.id),
      status: link(statuses[r.int(0, 2)]!.id),
    });
  });

  const TOTAL_ISSUES = 120;
  while (issues.length < TOTAL_ISSUES) {
    const n = issues.length;
    const p = n % projects.length;
    const type = r.weighted(TYPES.slice(0, 3));
    const status = r.weighted(statuses);
    const sprint = r.chance(0.7) ? r.pick(sprints.filter((s) => s.project._connect.key.id === projects[p]!.id)) : null;
    counters[p] = counters[p]! + 1;
    const key = `${PROJECTS[p]![0]}-${counters[p]}`;
    const issueId = row('issues', key);

    issues.push({
      id: issueId,
      key,
      title: `${r.pick(VERBS)} ${r.pick(SUBJECTS)}`,
      description: r.chance(0.75) ? `${r.pick(NOTES)} ${r.pick(NOTES)}` : null,
      type,
      priority: r.weighted(PRIORITIES),
      storyPoints: type === 'bug' && r.chance(0.5) ? null : r.weighted(POINTS),
      createdAt: stamp(-90 + (n % 90), r.int(8, 18)),
      dueDate: r.chance(0.4) ? day(r.int(1, 45)) : null,
      project: link(projects[p]!.id),
      status: link(status.id),
      sprint: maybeLink(sprint?.id),
      assignee: maybeLink(r.chance(0.85) ? r.pick(members).id : null),
    });

    // Parents are patched in afterwards: a foreign key cannot point at a row
    // inserted in the same batch.
    if (r.chance(0.35)) {
      relinks.push({
        collection: 'issues',
        id: issueId,
        data: { parent: link(r.pick(epicsByProject[p]!)) },
      });
    }
  }

  // Comments hang off their issue rather than a flat counter, so a comment's id
  // is `<issue key>/<n>` and stays put when the issue mix changes.
  const TOTAL_COMMENTS = 250;
  const comments: Record<string, unknown>[] = [];
  for (let pass = 0; comments.length < TOTAL_COMMENTS; pass++) {
    for (const issue of issues) {
      if (comments.length >= TOTAL_COMMENTS) break;
      if (pass > 0 && !r.chance(0.6)) continue;
      const issueKey = issue.key as string;
      comments.push({
        id: row('comments', `${issueKey}/${pass}`),
        body: r.pick(NOTES),
        createdAt: stamp(-80 + (comments.length % 80), r.int(9, 19)),
        issue: link(issue.id as string),
        author: link(r.pick(members).id),
      });
    }
  }

  return {
    rows: { members, issue_statuses: statuses, projects, sprints, issues, comments },
    relinks,
  };
}

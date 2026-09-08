/**
 * Issue-tracker data model: projects and sprints holding issues that members
 * work on and comment about.
 *
 * `key` is the table name, `apiName` is what the REST route and generated SDK
 * use. Relations declare only the to-one side plus the name of the to-many list
 * they create on the other collection — the backing foreign-key column is
 * derived by the applier.
 */

import { T, type CollectionDef } from '../../lib/types.ts';

const primaryKey = { name: 'id', type: T.uuid, primary: true, displayName: 'ID' } as const;

export const collections: CollectionDef[] = [
  {
    key: 'members',
    apiName: 'Member',
    displayName: 'Members',
    description: 'People who can be assigned work.',
    icon: 'group',
    fields: [
      primaryKey,
      { name: 'name', type: T.text, displayName: 'Name' },
      { name: 'email', type: T.varchar(160), unique: true, displayName: 'Email' },
      { name: 'avatarUrl', type: T.text, nullable: true, displayName: 'Avatar URL' },
      { name: 'createdAt', type: T.timestamp, displayName: 'Created' },
    ],
  },
  {
    key: 'issue_statuses',
    apiName: 'IssueStatus',
    displayName: 'Issue statuses',
    description: 'Workflow columns issues move through.',
    icon: 'flag',
    fields: [
      primaryKey,
      { name: 'name', type: T.varchar(64), unique: true, displayName: 'Name' },
      {
        name: 'category',
        type: T.varchar(32),
        displayName: 'Category',
        description: 'backlog · in_progress · done',
      },
      { name: 'sort', type: T.int, displayName: 'Order' },
    ],
  },
  {
    key: 'projects',
    apiName: 'Project',
    displayName: 'Projects',
    description: 'Top-level container for sprints and issues.',
    icon: 'folder',
    fields: [
      primaryKey,
      { name: 'key', type: T.varchar(12), unique: true, displayName: 'Key' },
      { name: 'name', type: T.text, displayName: 'Name' },
      { name: 'description', type: T.text, nullable: true, displayName: 'Description' },
      { name: 'createdAt', type: T.timestamp, displayName: 'Created' },
    ],
    relations: [
      { name: 'lead', to: 'members', reverseName: 'ledProjects', nullable: true, displayName: 'Lead' },
    ],
  },
  {
    key: 'sprints',
    apiName: 'Sprint',
    displayName: 'Sprints',
    description: 'Time-boxed iteration within a project.',
    icon: 'calendar_month',
    fields: [
      primaryKey,
      { name: 'name', type: T.text, displayName: 'Name' },
      { name: 'startsAt', type: T.date, displayName: 'Starts' },
      { name: 'endsAt', type: T.date, displayName: 'Ends' },
      {
        name: 'state',
        type: T.varchar(16),
        displayName: 'State',
        description: 'planned · active · completed',
      },
    ],
    relations: [{ name: 'project', to: 'projects', reverseName: 'sprints', displayName: 'Project' }],
  },
  {
    key: 'issues',
    apiName: 'Issue',
    displayName: 'Issues',
    description: 'A unit of work.',
    icon: 'task_alt',
    fields: [
      primaryKey,
      { name: 'key', type: T.varchar(24), unique: true, displayName: 'Key' },
      { name: 'title', type: T.text, displayName: 'Title' },
      { name: 'description', type: T.text, nullable: true, displayName: 'Description' },
      {
        name: 'type',
        type: T.varchar(16),
        displayName: 'Type',
        description: 'epic · story · task · bug',
      },
      {
        name: 'priority',
        type: T.varchar(16),
        displayName: 'Priority',
        description: 'low · medium · high · urgent',
      },
      { name: 'storyPoints', type: T.int, nullable: true, displayName: 'Points' },
      { name: 'createdAt', type: T.timestamp, displayName: 'Created' },
      { name: 'dueDate', type: T.date, nullable: true, displayName: 'Due' },
    ],
    relations: [
      { name: 'project', to: 'projects', reverseName: 'issues', displayName: 'Project' },
      { name: 'status', to: 'issue_statuses', reverseName: 'issues', onDelete: 'restrict', displayName: 'Status' },
      { name: 'sprint', to: 'sprints', reverseName: 'issues', nullable: true, displayName: 'Sprint' },
      { name: 'assignee', to: 'members', reverseName: 'assignedIssues', nullable: true, displayName: 'Assignee' },
      { name: 'parent', to: 'issues', reverseName: 'children', nullable: true, displayName: 'Parent' },
    ],
  },
  {
    key: 'comments',
    apiName: 'Comment',
    displayName: 'Comments',
    description: 'Discussion on an issue.',
    icon: 'chat',
    fields: [
      primaryKey,
      { name: 'body', type: T.text, displayName: 'Body' },
      { name: 'createdAt', type: T.timestamp, displayName: 'Created' },
    ],
    relations: [
      { name: 'issue', to: 'issues', reverseName: 'comments', displayName: 'Issue' },
      { name: 'author', to: 'members', reverseName: 'comments', displayName: 'Author' },
    ],
  },
];

/** FK-safe insert order. */
export const seedOrder = ['members', 'issue_statuses', 'projects', 'sprints', 'issues', 'comments'];

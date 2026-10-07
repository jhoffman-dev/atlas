import { parseObjectType, type ObjectType } from '../types/property-def.ts';

/**
 * The vault the query-language tests ask about: tasks in projects, owned by
 * people. Kept beside the tests rather than in each, so they agree on it.
 */
export const QUERY_TEST_TYPES: readonly ObjectType[] = [
  parseObjectType({
    name: 'task',
    label: 'Task',
    properties: {
      status: { kind: 'select', options: ['backlog', 'doing', 'done'] },
      due: 'date',
      estimate: 'number',
      project: { kind: 'relation', target: 'project' },
      owner: { kind: 'relation', target: 'person' },
      flagged: 'checkbox',
      labels: { kind: 'multiSelect', options: ['red', 'blue'] },
      notes: 'text',
    },
  }),
  parseObjectType({
    name: 'project',
    label: 'Project',
    properties: {
      status: { kind: 'select', options: ['active', 'paused'] },
      owner: { kind: 'relation', target: 'person' },
      due: 'date',
      lead: { kind: 'relation', target: 'nowhere' },
    },
  }),
  parseObjectType({ name: 'person', label: 'Person', properties: { role: 'text' } }),
];

import {
  createVaultPath,
  PARA_TYPE_FILES,
  parseObjectType,
  TASK_TYPE_FILE,
  type ObjectType,
} from '@dfai/domain';
import type { AssistantReads } from '../assistant/assistant-reads.ts';
import type { IndexPort } from '../index/ports.ts';
import { VaultAccessError } from '../vault/ports.ts';
import { apiFixture, type ApiFixture } from './api-fixture.ts';
import { fakeIndexPort, fakeVaultFs } from './fake-ports.ts';
import { ftsSearch } from './fts-search.ts';
import { jsonMarkdown } from './json-markdown.ts';
import { atlasQueryIndex } from './query-index.ts';

/*
 * A small vault for the assistant's tools (P32-04): a person at a company,
 * a project, three meetings with transcripts, tasks, waiting-fors, follow-ups
 * and a decision — every query run for real against SQLite, search against
 * FTS5, on a pinned day. Test support only.
 */

export const ASSISTANT_TODAY = '2999-03-13';

/** How the index's queries say "today", replaced by the pinned day. */
const INDEX_TODAY = "date('now', 'localtime'";

/** TODAY, that many days back, as `YYYY-MM-DD`. */
export function daysAgo(days: number): string {
  return new Date(Date.UTC(2999, 2, 13 - days, 12)).toISOString().slice(0, 10);
}

/** Noon that day, so the day is the same wherever the test runs. */
export const changedDaysAgo = (days: number): number => Date.UTC(2999, 2, 13 - days, 12);

export const ASSISTANT_TYPES: readonly ObjectType[] = [
  parseObjectType({
    name: 'person',
    label: 'Person',
    properties: { role: 'text', company: { kind: 'relation', target: 'company' } },
  }),
  parseObjectType({ name: 'company', label: 'Company', properties: {} }),
  parseObjectType({
    name: 'meeting',
    label: 'Meeting',
    properties: {
      date: 'date',
      people: { kind: 'relation', target: 'person', many: true },
      companies: { kind: 'relation', target: 'company', many: true },
      project: { kind: 'relation', target: ['project', 'area'] },
      tasks: { kind: 'relation', target: 'task', many: true },
    },
  }),
  parseObjectType({
    name: 'decision',
    label: 'Decision',
    properties: {
      date: 'date',
      meeting: { kind: 'relation', target: 'meeting' },
      project: { kind: 'relation', target: 'project' },
      source: 'text',
    },
  }),
  TASK_TYPE_FILE.type,
  ...PARA_TYPE_FILES.map((file) => file.type),
  parseObjectType({
    name: 'resource',
    label: 'Resource',
    properties: { project: { kind: 'relation', target: 'project' } },
  }),
];

/** A note with JSON frontmatter, as `jsonMarkdown` reads it. */
export const jsonNote = (frontmatter: Record<string, unknown>, body = ''): string =>
  `---\n${JSON.stringify(frontmatter)}\n---\n\n${body}\n`;

const transcript = (turns: readonly string[]): string =>
  [
    '## Summary',
    '',
    'What was said.',
    '',
    '## Transcript',
    '',
    ...turns.flatMap((turn) => [turn, '']),
  ].join('\n');

export const MARA = 'People/Mara Quill.md';
export const TOBIAS = 'People/Tobias Fenn.md';
export const LARKSPUR = 'Companies/Larkspur Payroll.md';
export const MIGRATION = 'Projects/Payroll Migration.md';
export const KICKOFF = 'Meetings/Kickoff.md';
export const CUTOVER = 'Meetings/Cut-over review.md';
export const OLD_SYNC = 'Meetings/Old sync.md';

export const ASSISTANT_FILES: Readonly<Record<string, string>> = {
  [MARA]: jsonNote({
    type: 'person',
    role: 'Controller',
    company: '[[Larkspur Payroll]]',
    aliases: ['MQ'],
  }),
  [TOBIAS]: jsonNote({ type: 'person', company: '[[Larkspur Payroll]]' }),
  [LARKSPUR]: jsonNote({ type: 'company' }),
  [MIGRATION]: jsonNote({ type: 'project', status: 'active' }, 'For [[Larkspur Payroll]].'),
  [KICKOFF]: jsonNote(
    {
      type: 'meeting',
      date: daysAgo(10),
      people: ['[[Mara Quill]]', '[[Tobias Fenn]]'],
      companies: ['[[Larkspur Payroll]]'],
      project: '[[Payroll Migration]]',
      tasks: ['[[Chase the bank]]', '[[Send the contract]]'],
    },
    transcript([
      '**Mara Quill** [00:00:05] The cut-over has to wait for the bank file. ^t0001',
      '**Tobias Fenn** [00:00:40] I will send the contract on Friday. ^t0002',
      '**MQ** [00:01:10] And the bank file needs a rollback plan. ^t0003',
      '**You** [00:02:00] I will chase the bank. ^t0004',
    ]),
  ),
  [CUTOVER]: jsonNote(
    {
      type: 'meeting',
      date: daysAgo(3),
      people: ['[[Mara Quill]]'],
      companies: ['[[Larkspur Payroll]]'],
      project: '[[Payroll Migration]]',
    },
    transcript([
      '**Mara Quill** [00:00:10] The rollback plan is signed off.',
      '**Tobias Fenn** [00:00:30] Then the cut-over is on for Monday. ^t0002',
    ]),
  ),
  [OLD_SYNC]: jsonNote(
    { type: 'meeting', date: daysAgo(400), people: ['[[Mara Quill]]'] },
    transcript(['**Mara Quill** [00:00:05] Nothing about the bank yet. ^t0001']),
  ),
  'Meetings/Later.md': jsonNote(
    { type: 'meeting', date: daysAgo(-5), people: ['[[Mara Quill]]'] },
    transcript(['**Mara Quill** The bank file again. ^t0001']),
  ),
  'Tasks/Send the contract.md': jsonNote({
    type: 'task',
    status: 'waiting',
    waiting_on: '[[Tobias Fenn]]',
    project: '[[Payroll Migration]]',
    source: '[[Kickoff#^t0002]]',
  }),
  'Tasks/Get the bank file.md': jsonNote({
    type: 'task',
    status: 'waiting',
    waiting_on: '[[Mara Quill]]',
    project: '[[Payroll Migration]]',
  }),
  'Tasks/Draft the plan.md': jsonNote(
    { type: 'task', status: 'next-action', project: '[[Payroll Migration]]', due: daysAgo(2) },
    'Ask [[Mara Quill]] about the cut-over.',
  ),
  // A follow-up made from the kickoff: joined by the meeting's `tasks`, never naming Mara.
  'Tasks/Chase the bank.md': jsonNote({
    type: 'task',
    status: 'inbox',
    tags: ['follow-up'],
    source: '[[Kickoff#^t0004]]',
  }),
  'Tasks/Finished.md': jsonNote(
    { type: 'task', status: 'archive', project: '[[Payroll Migration]]' },
    'With [[Mara Quill]].',
  ),
  'Decisions/Roll back first.md': jsonNote({
    type: 'decision',
    date: daysAgo(10),
    meeting: '[[Kickoff]]',
    project: '[[Payroll Migration]]',
    source: '[[Kickoff#^t0003]]',
  }),
  'Resources/Payroll runbook.md': jsonNote(
    { type: 'resource', project: '[[Payroll Migration]]' },
    'Written with [[Mara Quill]] about the bank file.',
  ),
};

export const ASSISTANT_MODIFIED: Readonly<Record<string, number>> = {
  'Tasks/Send the contract.md': changedDaysAgo(9),
  'Tasks/Get the bank file.md': changedDaysAgo(4),
  'Resources/Payroll runbook.md': changedDaysAgo(2),
};

/** The vault as the assistant's reads see it, with what each port was asked. */
export interface AssistantVault {
  readonly reads: AssistantReads;
  readonly clock: { today: () => string };
  /** Every note read from the vault, in order. */
  readonly read: string[];
  /** Every SQL statement the index was asked, in order. */
  readonly asked: string[];
  /** Every search the index was asked, in order. */
  readonly searched: string[];
}

export function assistantVault({
  files = ASSISTANT_FILES,
  modified = ASSISTANT_MODIFIED,
  types = ASSISTANT_TYPES,
  index = {},
}: {
  files?: Readonly<Record<string, string>>;
  modified?: Readonly<Record<string, number>>;
  types?: readonly ObjectType[];
  index?: Partial<IndexPort>;
} = {}): AssistantVault {
  const markdown = jsonMarkdown();
  const run = atlasQueryIndex({ files, markdown, modified });
  const search = ftsSearch(files);
  const read: string[] = [];
  const asked: string[] = [];
  const searched: string[] = [];
  const fs = fakeVaultFs({
    readTextFile: async (path) => {
      read.push(path);
      const text = files[path];
      if (text === undefined) throw new VaultAccessError(`no ${path}`);
      return { text, modified: modified[path] ?? 1 };
    },
  });
  const reads: AssistantReads = {
    index: fakeIndexPort({
      query: (sql, parameters) => {
        asked.push(sql);
        return run(sql.replaceAll(INDEX_TODAY, `date('${ASSISTANT_TODAY}'`), parameters);
      },
      search: (query, limit, scope) => {
        searched.push(query);
        return search(query, limit, scope);
      },
      ...index,
    }),
    fs,
    markdown,
    types,
    notePaths: Object.keys(files).map(createVaultPath),
  };
  return { reads, clock: { today: () => ASSISTANT_TODAY }, read, asked, searched };
}

/** The fixture's types, written as the vault keeps them in `.atlas/types`. */
const TYPE_FILES = Object.fromEntries(
  ASSISTANT_TYPES.map((type) => [
    `.atlas/types/${type.name}.md`,
    jsonNote({
      name: type.name,
      label: type.label,
      properties: Object.fromEntries(type.properties.map((property) => [property.key, property])),
    }),
  ]),
);

/** The fixture vault with its types, as the API reads it. */
export const ASSISTANT_API_FILES: Readonly<Record<string, string>> = {
  ...ASSISTANT_FILES,
  ...TYPE_FILES,
};

/** The fixture vault behind the API's router, with every SQL statement the index was asked. */
export function assistantApi(): { api: ApiFixture; asked: string[] } {
  const markdown = jsonMarkdown();
  const files = ASSISTANT_API_FILES;
  const run = atlasQueryIndex({ files, markdown, modified: ASSISTANT_MODIFIED });
  const asked: string[] = [];
  const api = apiFixture({
    files: { ...files },
    markdown,
    index: {
      query: (sql, parameters) => {
        asked.push(sql);
        return run(sql.replaceAll(INDEX_TODAY, `date('${ASSISTANT_TODAY}'`), parameters);
      },
      search: ftsSearch(files),
    },
  });
  return { api, asked };
}

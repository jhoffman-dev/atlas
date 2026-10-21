import { describe, expect, it } from 'vitest';
import {
  LINKED_SECTION_LIMIT,
  PARA_TYPE_FILES,
  parseObjectType,
  TASK_TYPE_FILE,
  type LinkedSectionId,
  type ObjectType,
} from '@dfai/domain';
import { fakeIndexPort } from '../testing/fake-ports.ts';
import { jsonMarkdown } from '../testing/json-markdown.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';
import { readLinkedPage, type LinkedSection } from './read-linked-page.ts';

/**
 * Adversarial pass on linked pages (P30-06, PR #117). Each test names one
 * invariant; the ones marked FAILING in the PR's attack report prove a bug.
 *
 * The index stand-in answers as the real one does (`src-tauri/src/index.rs`):
 * it runs the statement as compiled — its own LIMIT included — and says
 * `truncated` only past the index's own cap of 5,000 rows.
 */
const TODAY = '2999-03-13';
const INDEX_TODAY = "date('now', 'localtime'";
const INDEX_ROW_CAP = 5_000;

/** The types as this repository's vault declares them (`vault/.atlas/types`), cut to what matters. */
const TYPES: readonly ObjectType[] = [
  parseObjectType({
    name: 'person',
    label: 'Person',
    properties: { role: 'text', company: { kind: 'relation', target: 'company' } },
  }),
  parseObjectType({
    name: 'company',
    label: 'Company',
    properties: {
      ceo: { kind: 'relation', target: 'person' },
      employees: { kind: 'relation', target: 'person', many: true },
    },
  }),
  parseObjectType({
    name: 'meeting',
    label: 'Meeting',
    properties: {
      date: 'date',
      people: { kind: 'relation', target: 'person', many: true },
      companies: { kind: 'relation', target: 'company', many: true },
      project: { kind: 'relation', target: 'project' },
    },
  }),
  parseObjectType({
    name: 'decision',
    label: 'Decision',
    properties: {
      date: 'date',
      meeting: { kind: 'relation', target: 'meeting' },
      project: { kind: 'relation', target: 'project' },
      people: { kind: 'relation', target: 'person', many: true },
    },
  }),
  TASK_TYPE_FILE.type,
  ...PARA_TYPE_FILES.map((file) => file.type),
];

const note = (frontmatter: Record<string, unknown>, body = ''): string =>
  `---\n${JSON.stringify(frontmatter)}\n---\n\n${body}\n`;

const MARA = 'People/Mara Quill.md';
const TOBIAS = 'People/Tobias Fenn.md';
const LARKSPUR = 'Companies/Larkspur Payroll.md';
const MIGRATION = 'Projects/Payroll Migration.md';
const EVERYTHING = { meetings: 'all', decisions: 'all', notes: 'all' } as const;

async function page(files: Readonly<Record<string, string>>, notePath: string, typeName: string) {
  const run = atlasQueryIndex({ files, markdown: jsonMarkdown() });
  const index = fakeIndexPort({
    query: async (sql, parameters) => {
      const answer = await run(sql.replaceAll(INDEX_TODAY, `date('${TODAY}'`), parameters);
      const truncated = answer.rows.length > INDEX_ROW_CAP;
      return { ...answer, rows: answer.rows.slice(0, INDEX_ROW_CAP), truncated };
    },
  });
  const sections = await readLinkedPage({
    index,
    clock: { today: () => TODAY },
    types: TYPES,
    notePaths: Object.keys(files),
    notePath,
    typeName,
    ranges: EVERYTHING,
  });
  const section = (id: LinkedSectionId): LinkedSection => {
    const found = sections.find((one) => one.id === id);
    if (found === undefined) throw new Error(`no ${id} section`);
    return found;
  };
  const titles = (id: LinkedSectionId) => section(id).rows.map((row) => row.title);
  const everyPath = () => sections.flatMap((one) => one.rows.map((row) => row.path));
  return { sections, section, titles, everyPath };
}

/** A project with `count` backlog tasks named to sort first, and the files so far. */
function projectWithBacklog(count: number): Record<string, string> {
  const files: Record<string, string> = { [MIGRATION]: note({ type: 'project' }) };
  for (let at = 0; at < count; at += 1) {
    const name = `Backlog ${String(at).padStart(4, '0')}`;
    files[`Tasks/${name}.md`] = note({
      type: 'task',
      status: 'backlog',
      project: '[[Payroll Migration]]',
    });
  }
  return files;
}

describe('readLinkedPage under attack: a section past its cap of 200', () => {
  // The section's query says LIMIT 200 and the index runs it as written, so
  // exactly 200 rows come back with truncated: false — the index only says
  // truncated past its own 5,000. Nothing ever asks for a 201st row.
  it('says a section was cut off when one more note than the cap matches', async () => {
    const project = await page(projectWithBacklog(LINKED_SECTION_LIMIT + 1), MIGRATION, 'project');
    expect(project.section('tasks').rows).toHaveLength(LINKED_SECTION_LIMIT);
    expect(project.section('tasks').truncated).toBe(true);
  });

  it('does not say a section was cut off when exactly the cap matches', async () => {
    const project = await page(projectWithBacklog(LINKED_SECTION_LIMIT), MIGRATION, 'project');
    expect(project.section('tasks').rows).toHaveLength(LINKED_SECTION_LIMIT);
    expect(project.section('tasks').truncated).toBe(false);
  });

  // The hint is built on "every open task was read"; with the cut unseen it
  // tells James a project has no next action when its next action is row 201.
  it('never says "No next action" of a project whose next action is past the cut', async () => {
    const files = projectWithBacklog(LINKED_SECTION_LIMIT);
    files['Tasks/Zero in on the cut-over.md'] = note({
      type: 'task',
      status: 'next-action',
      project: '[[Payroll Migration]]',
    });
    const project = await page(files, MIGRATION, 'project');
    expect(project.section('tasks').hint).toBeNull();
  });
});

describe('readLinkedPage under attack: what is linked must be listed somewhere', () => {
  // The Company type ships with `ceo` and `employees` relations to people.
  // People asks only `FROM person WHERE company = this`, and Linked notes
  // leaves the Person type out, so a person the company itself names is in
  // no section at all.
  it('lists under People a person the company’s own employees relation names', async () => {
    const larkspur = await page(
      {
        [LARKSPUR]: note({
          type: 'company',
          ceo: '[[Tobias Fenn]]',
          employees: ['[[Tobias Fenn]]'],
        }),
        [TOBIAS]: note({ type: 'person' }),
        [MARA]: note({ type: 'person', company: '[[Larkspur Payroll]]' }),
      },
      LARKSPUR,
      'company',
    );
    expect(larkspur.titles('people')).toEqual(['Mara Quill', 'Tobias Fenn']);
  });

  // Same gap, one hop on: the waiting-for hop goes only through the
  // person's `company`, so what is waited on from the CEO is not the
  // company's.
  it('lists under a company’s Waiting for what is waited on from a person its employees relation names', async () => {
    const larkspur = await page(
      {
        [LARKSPUR]: note({ type: 'company', employees: ['[[Tobias Fenn]]'] }),
        [TOBIAS]: note({ type: 'person' }),
        'Tasks/Chase the invoice.md': note({
          type: 'task',
          status: 'waiting',
          waiting_on: '[[Tobias Fenn]]',
        }),
      },
      LARKSPUR,
      'company',
    );
    expect(larkspur.titles('waiting')).toEqual(['Chase the invoice']);
  });

  // Meetings asks `people = this` alone when Meeting declares the relation,
  // and Linked notes leaves the Meeting type out: a meeting that names the
  // person in its text (an attendee the importer could not match, a
  // hand-written note) is in no section.
  it('lists a meeting that links the person in its body in some section of the person’s page', async () => {
    const mara = await page(
      {
        [MARA]: note({ type: 'person' }),
        'Meetings/Cut-over review.md': note(
          { type: 'meeting', date: '2999-03-10' },
          'Mentioned by [[Mara Quill]].',
        ),
      },
      MARA,
      'person',
    );
    expect(mara.everyPath()).toContain('Meetings/Cut-over review.md');
  });

  // The same on a project: a task that links the project anywhere but its
  // `project` property is in neither Open tasks nor Linked notes.
  it('lists an open task that links the project in its body in some section of the project’s page', async () => {
    const project = await page(
      {
        [MIGRATION]: note({ type: 'project' }),
        'Tasks/Ask about the cut-over.md': note(
          { type: 'task', status: 'next-action' },
          'For [[Payroll Migration]].',
        ),
      },
      MIGRATION,
      'project',
    );
    expect(project.everyPath()).toContain('Tasks/Ask about the cut-over.md');
  });
});

describe('readLinkedPage under attack: a page never lists itself', () => {
  // `CONNECTED TO this` leaves the page out; `people = this` does not. A
  // note of two types that names itself is listed on its own page.
  it('leaves the page out of a section joined by a relation', async () => {
    const mara = await page(
      {
        [MARA]: note({
          type: ['person', 'meeting'],
          date: '2999-03-10',
          people: ['[[Mara Quill]]'],
        }),
      },
      MARA,
      'person',
    );
    expect(mara.everyPath()).not.toContain(MARA);
  });
});

/** A small seeded generator (mulberry32): the same vaults on every run. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** A vault of notes that link Mara, Tobias or nobody, by property, body, both or neither. */
function randomVault(random: () => number): [string, string][] {
  const pick = <T>(from: readonly T[]): T => from[Math.floor(random() * from.length)] as T;
  const who = () => pick(['[[Mara Quill]]', '[[Tobias Fenn]]', '[[People/Mara Quill|MQ]]', null]);
  const body = () =>
    pick(['', 'With [[Mara Quill]].', '[[Mara Quill]] [[Mara Quill#Notes]]', '[[Tobias Fenn]]']);
  const entries: [string, string][] = [
    [
      MARA,
      note(
        { type: 'person', company: '[[Larkspur Payroll]]' },
        pick(['', '[[Task 3]]', '[[Meeting 1]]']),
      ),
    ],
    [TOBIAS, note({ type: 'person' }, body())],
    [LARKSPUR, note({ type: 'company' }, body())],
    [MIGRATION, note({ type: 'project' }, body())],
  ];
  for (let at = 0; at < 30; at += 1) {
    const folder = pick(['', 'Archive/']);
    const kind = pick(['Task', 'Meeting', 'Decision', 'Resource']);
    const path = `${folder}${kind}s/${kind} ${at}.md`;
    const linked = { people: [who(), who()].filter((one) => one !== null), source: who() ?? '' };
    const frontmatter: Record<string, unknown> =
      kind === 'Task'
        ? {
            type: 'task',
            status: pick(['inbox', 'next-action', 'waiting', 'archive', 'someday']),
            waiting_on: who(),
            source: linked.source,
          }
        : kind === 'Resource'
          ? { type: 'resource' }
          : { type: kind.toLowerCase(), date: pick(['2999-03-10', '2999-01-02', '']), ...linked };
    entries.push([path, note(frontmatter, body())]);
  }
  return entries;
}

describe('readLinkedPage under attack: properties over seeded vaults', () => {
  const SEEDS = [1, 7, 42, 1999, 30_06];

  it.each(SEEDS)(
    'lists no note twice, never the page, never an archived note (seed %i)',
    async (seed) => {
      const mara = await page(Object.fromEntries(randomVault(seeded(seed))), MARA, 'person');
      const paths = mara.everyPath();
      expect(paths).toHaveLength(new Set(paths).size);
      expect(paths).not.toContain(MARA);
      expect(paths.filter((path) => path.startsWith('Archive/'))).toEqual([]);
      for (const row of mara.section('tasks').rows)
        expect(row.values['status']).not.toBe('archive');
    },
  );

  it.each(SEEDS)(
    'answers the same whatever order the notes were indexed in (seed %i)',
    async (seed) => {
      const entries = randomVault(seeded(seed));
      const forwards = await page(Object.fromEntries(entries), MARA, 'person');
      const backwards = await page(Object.fromEntries([...entries].reverse()), MARA, 'person');
      const listed = (read: typeof forwards) =>
        read.sections.map((section) => [section.id, section.rows.map((row) => row.path)]);
      expect(listed(backwards)).toEqual(listed(forwards));
    },
  );
});

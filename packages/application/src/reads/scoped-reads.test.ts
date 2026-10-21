import { describe, expect, it } from 'vitest';
import { QUERY_BLOCK_NODE, queryBlockNode, type NoteChange } from '@atlas/domain';
import {
  ARCHIVE_SCOPE,
  AUTOMATIONS_SCOPE,
  INBOX_CHOICES_SCOPE,
  INBOX_SCOPE,
  MENTIONS_SCOPE,
  notePaneScope,
  PEOPLE_SCOPE,
  PERSON_EMAILS_SCOPE,
  PROJECTS_SCOPE,
  QUERY_SCOPE,
  RULE_QUERY_SCOPE,
  scopeTouched,
  REVIEW_SCOPE,
  SEARCH_SCOPE,
  SECRETS_SCOPE,
  SYNC_SCOPE,
  TAGS_SCOPE,
  TERMS_SCOPE,
  typeTableScope,
  UNKNOWN_NEWS,
  type IndexNews,
  type PaneNote,
  type ReadScope,
} from './scoped-reads.ts';

const changed = (path: string, type: string | null = null, extra: Partial<NoteChange> = {}) =>
  ({ kind: 'changed', path, type, digest: 'b', before: 'a', ...extra }) as NoteChange;

const news = (changes: NoteChange[], facets: IndexNews['facets'] = new Set()): IndexNews => ({
  changes,
  facets,
});

const reaches = (scope: ReadScope, ...changes: NoteChange[]) => scopeTouched(scope, news(changes));

describe('which of the index’s news reaches a pane’s reader', () => {
  it('reaches every reader when what changed is not known: a build, a failure, a loud refresh', () => {
    expect(scopeTouched({ notes: ['a.md'] }, UNKNOWN_NEWS)).toBe(true);
    expect(scopeTouched({}, UNKNOWN_NEWS)).toBe(true);
  });

  it('reaches a reader of a note by its path, case aside, and no other note', () => {
    const scope = { notes: ['Notes/Recipes.md'] };
    expect(reaches(scope, changed('notes/recipes.md'))).toBe(true);
    expect(reaches(scope, changed('Notes/Recipes old.md'))).toBe(false);
  });

  it('reaches a reader of the notes a note links to by their name, in whatever folder', () => {
    const scope = { linkedNames: ['sourdough'] };
    expect(reaches(scope, changed('Kitchen/Sourdough.md'))).toBe(true);
    expect(reaches(scope, changed('Sourdough starter.md'))).toBe(false);
  });

  it('reaches a reader of a folder for a note in it at any depth, and not one beside it', () => {
    const scope = { folders: ['Inbox'] };
    expect(reaches(scope, changed('Inbox/Call the bank.md'))).toBe(true);
    expect(reaches(scope, changed('Inbox/Proposals/2026/Call Tobias.md'))).toBe(true);
    expect(reaches(scope, changed('Inboxes/Call the bank.md'))).toBe(false);
  });

  it('reaches a reader of a folder for a note that has left it: a removal is where it was', () => {
    const left = { ...changed('Inbox/Call the bank.md'), kind: 'removed' } as NoteChange;
    expect(reaches({ folders: ['Inbox'] }, left)).toBe(true);
  });

  it('reaches a reader of a type for a note of it, of two types, or one that left it', () => {
    const scope = { types: ['task'] };
    expect(reaches(scope, changed('Tasks/Buy flour.md', 'Task'))).toBe(true);
    expect(reaches(scope, changed('Tasks/Buy flour.md', 'project,task'))).toBe(true);
    expect(reaches(scope, changed('Tasks/Buy flour.md', null, { beforeType: 'task' }))).toBe(true);
    expect(reaches(scope, changed('Tasks/Buy flour.md', 'project'))).toBe(false);
    expect(reaches(scope, changed('Tasks/Buy flour.md', 'tasks'))).toBe(false);
  });

  it('reaches a reader of a facet only when a write changed it', () => {
    const scope: ReadScope = { facets: ['graph'] };
    expect(scopeTouched(scope, news([changed('a.md')], new Set(['graph'])))).toBe(true);
    expect(scopeTouched(scope, news([changed('a.md')], new Set(['tags'])))).toBe(false);
  });

  it('reaches a reader of any note for any change, and none for news of no note', () => {
    expect(reaches({ anyNote: true }, changed('Anywhere/at all.md'))).toBe(true);
    expect(reaches({ anyNote: true })).toBe(false);
  });

  it('reaches a reader of the import’s meetings for one stamped, declared or settled before', () => {
    const scope: ReadScope = { imports: true };
    expect(reaches(scope, changed('Calls/Kickoff.md', null, { importDeclared: true }))).toBe(true);
    expect(reaches(scope, changed('Calls/Kickoff.md', null, { importOutcome: 'imported' }))).toBe(
      true,
    );
    expect(
      reaches(scope, changed('Calls/Kickoff.md', null, { beforeImportOutcome: 'imported' })),
    ).toBe(true);
    expect(reaches(scope, changed('Calls/Kickoff.md'))).toBe(false);
  });

  it('reaches nothing a reader is not made from', () => {
    const scope: ReadScope = {
      notes: ['a.md'],
      linkedNames: ['b'],
      folders: ['Inbox'],
      types: ['person'],
      facets: ['graph'],
    };
    expect(reaches(scope, changed('Notes/c.md', 'project'))).toBe(false);
  });
});

const plain = (body: string, more: Partial<PaneNote> = {}): PaneNote => ({
  path: 'Notes/Recipes.md',
  frontmatter: null,
  properties: {},
  originalBody: body,
  doc: { content: [{ type: 'paragraph' }] },
  ...more,
});

describe('what a note’s pane is made from', () => {
  it('is a plain note itself, the notes it links to or embeds by name, and the graph', () => {
    const scope = notePaneScope(
      plain('See [[Kitchen/Sourdough#Starter|the starter]] and ![[Rye#^b1]], and [[rye]].'),
      'Notes/Recipes.md',
    );
    expect(scope).toEqual({
      notes: ['Notes/Recipes.md'],
      linkedNames: ['sourdough', 'rye'],
      facets: ['graph'],
    });
  });

  it('counts the links its properties hold, as its panel shows them', () => {
    const scope = notePaneScope(
      plain('', { frontmatter: 'related: "[[Tobias Fenn]]"' }),
      'Notes/Recipes.md',
    );
    expect(scope.linkedNames).toEqual(['tobias fenn']);
  });

  it('is any note for a typed note, a view or dashboard, DFAI’s own, or one with a query block', () => {
    const at = 'Notes/Recipes.md';
    expect(notePaneScope(plain('', { properties: { type: 'project' } }), at)).toEqual({
      anyNote: true,
    });
    expect(notePaneScope(plain('', { properties: { atlas: 'view' } }), at)).toEqual({
      anyNote: true,
    });
    expect(notePaneScope(plain('', { path: '.atlas/views/Open.md' }), at)).toEqual({
      anyNote: true,
    });
    const nested = { type: 'bulletList', content: [queryBlockNode('from task')] };
    expect(notePaneScope(plain('', { doc: { content: [nested] } }), at)).toEqual({
      anyNote: true,
    });
    expect(nested.content[0]?.type).toBe(QUERY_BLOCK_NODE);
  });

  it('hears its own note changed under the other Unicode form of its name (A21-02)', () => {
    const composed = plain('Words.', { path: 'Notes/Caf\u00e9.md' });
    const decomposed = plain('Words.', { path: 'Notes/Cafe\u0301.md' });
    expect(reaches(notePaneScope(composed, composed.path), changed(decomposed.path))).toBe(true);
    expect(reaches(notePaneScope(decomposed, decomposed.path), changed(composed.path))).toBe(true);
  });

  it('is the note’s path and the graph while the note is still being read', () => {
    expect(notePaneScope(null, 'Notes/Recipes.md')).toEqual({
      notes: ['Notes/Recipes.md'],
      facets: ['graph'],
    });
  });
});

describe('what the pages and the window’s readers of one kind of note are made from', () => {
  const plainEdit = changed('Notes/Sourdough.md');
  const tick = changed('Tasks/Buy flour.md', 'task');
  const filed = { ...changed('Inbox/Call the bank.md'), kind: 'removed' } as NoteChange;
  const project = changed('Projects/Larkspur launch.md', 'project');
  const person = changed('People/Mara Quill.md', 'person');
  const company = changed('Companies/Larkspur Payroll.md', 'company');

  it('reads none of them again for an edit to a plain note, but its mentions', () => {
    for (const scope of [
      REVIEW_SCOPE,
      INBOX_SCOPE,
      INBOX_CHOICES_SCOPE,
      PEOPLE_SCOPE,
      PROJECTS_SCOPE,
      PERSON_EMAILS_SCOPE,
    ]) {
      expect(reaches(scope, plainEdit)).toBe(false);
    }
    expect(reaches(MENTIONS_SCOPE, plainEdit)).toBe(true);
  });

  it('hears a note in a folder it reads whatever Unicode form the folder is spelt in (A21-02)', () => {
    // `Inbox` is plain ASCII; a folder read by its name, as the Inbox reads its own, may not be.
    const composed = { folders: ['Inbox/Caf\u00e9'] };
    const decomposed = { folders: ['Inbox/Cafe\u0301'] };
    expect(reaches(composed, changed('Inbox/Cafe\u0301/Call.md'))).toBe(true);
    expect(reaches(decomposed, changed('Inbox/Caf\u00e9/Call.md'))).toBe(true);
  });

  it('reads Today and the Inbox again for a task, and a note leaving the Inbox', () => {
    expect([reaches(REVIEW_SCOPE, tick), reaches(INBOX_SCOPE, tick)]).toEqual([true, true]);
    expect([reaches(REVIEW_SCOPE, filed), reaches(INBOX_SCOPE, filed)]).toEqual([true, true]);
    expect(reaches(PEOPLE_SCOPE, tick)).toBe(false);
  });

  it('reads Today, the Inbox (its rows resolve projects), its choices and the projects again for a project', () => {
    expect(reaches(REVIEW_SCOPE, project)).toBe(true);
    expect(reaches(INBOX_CHOICES_SCOPE, project)).toBe(true);
    expect(reaches(PROJECTS_SCOPE, project)).toBe(true);
    expect(reaches(INBOX_SCOPE, project)).toBe(true);
    expect(reaches(PEOPLE_SCOPE, project)).toBe(false);
  });

  it('reads the people, the choices and the owner’s addresses again for a person; a company for the addresses', () => {
    expect(
      [PEOPLE_SCOPE, INBOX_CHOICES_SCOPE, PERSON_EMAILS_SCOPE].map((at) => reaches(at, person)),
    ).toEqual([true, true, true]);
    expect(reaches(PERSON_EMAILS_SCOPE, company)).toBe(true);
    expect(reaches(PEOPLE_SCOPE, company)).toBe(false);
  });
});

describe('which of the index’s news reaches the window’s controllers (#326)', () => {
  const rule = changed('.atlas/automations/Weekly review.md');
  const log = { ...changed('.atlas/automations/log/r-1.md'), kind: 'added' } as NoteChange;
  const plain = changed('Notes/Sourdough.md');

  it('tells sync of every note changed, and of news whose notes are not known', () => {
    expect([reaches(SYNC_SCOPE, plain), reaches(SYNC_SCOPE, rule)]).toEqual([true, true]);
    expect(scopeTouched(SYNC_SCOPE, UNKNOWN_NEWS)).toBe(true);
  });

  it('reads the automations again for a rule or its log, and not for a note saved elsewhere', () => {
    expect([reaches(AUTOMATIONS_SCOPE, rule), reaches(AUTOMATIONS_SCOPE, log)]).toEqual([
      true,
      true,
    ]);
    expect(reaches(AUTOMATIONS_SCOPE, plain)).toBe(false);
    expect(reaches(AUTOMATIONS_SCOPE, changed('.atlas/automations-old/Weekly review.md'))).toBe(
      false,
    );
    expect(scopeTouched(AUTOMATIONS_SCOPE, UNKNOWN_NEWS)).toBe(true);
  });

  it('reads the secrets again for any note: any note can be a source that names one', () => {
    expect(reaches(SECRETS_SCOPE, plain)).toBe(true);
  });
});

describe('which of the index’s news reaches the pages that still read on every news (#327)', () => {
  const plain = changed('Notes/Sourdough.md');

  it('reads the Archive again for a note in it, or for a project, whose `para` can archive it', () => {
    expect(reaches(ARCHIVE_SCOPE, changed('Archive/2025/Old plan.md'))).toBe(true);
    expect(reaches(ARCHIVE_SCOPE, changed('archive/Old plan.md'))).toBe(true);
    expect(
      reaches(ARCHIVE_SCOPE, { ...changed('Archive/Old.md'), kind: 'removed' } as NoteChange),
    ).toBe(true);
    expect(reaches(ARCHIVE_SCOPE, changed('Projects/Garden.md', 'project'))).toBe(true);
    expect(reaches(ARCHIVE_SCOPE, plain)).toBe(false);
    expect(reaches(ARCHIVE_SCOPE, changed('Archives/Old plan.md'))).toBe(false);
    expect(reaches(ARCHIVE_SCOPE, changed('Tasks/Call.md', 'task'))).toBe(false);
    expect(scopeTouched(ARCHIVE_SCOPE, UNKNOWN_NEWS)).toBe(true);
  });

  it('reads the terms again for a term, a person or a company — what the vocabulary is spelt from', () => {
    expect(reaches(TERMS_SCOPE, changed('Terms/Kubernetes.md', 'term'))).toBe(true);
    expect(reaches(TERMS_SCOPE, changed('People/Ada.md', 'person'))).toBe(true);
    expect(reaches(TERMS_SCOPE, changed('Companies/Acme.md', 'company'))).toBe(true);
    // A note that stopped being a term leaves the list.
    expect(reaches(TERMS_SCOPE, changed('Notes/Was a term.md', null, { beforeType: 'term' }))).toBe(
      true,
    );
    expect(reaches(TERMS_SCOPE, plain)).toBe(false);
    expect(reaches(TERMS_SCOPE, changed('Tasks/Call.md', 'task'))).toBe(false);
    expect(scopeTouched(TERMS_SCOPE, UNKNOWN_NEWS)).toBe(true);
  });

  it('reads a type’s table again for a note of that type, or a type file, and not another type', () => {
    const tasks = typeTableScope('task');
    expect(reaches(tasks, changed('Tasks/Call.md', 'task'))).toBe(true);
    expect(reaches(tasks, changed('Tasks/Call.md', 'task,project'))).toBe(true);
    expect(reaches(tasks, changed('Notes/Done with.md', null, { beforeType: 'task' }))).toBe(true);
    expect(reaches(tasks, changed('.atlas/types/task.md'))).toBe(true);
    expect(reaches(tasks, changed('Projects/Garden.md', 'project'))).toBe(false);
    expect(reaches(tasks, plain)).toBe(false);
    expect(scopeTouched(tasks, UNKNOWN_NEWS)).toBe(true);
  });

  it('reads the tags page again for any note: any note can take the tag', () => {
    expect(reaches(TAGS_SCOPE, plain)).toBe(true);
    expect(scopeTouched(TAGS_SCOPE, UNKNOWN_NEWS)).toBe(true);
  });

  it('reads a query of the whole vault again for any note: the query page, the rule editor, search', () => {
    for (const scope of [QUERY_SCOPE, RULE_QUERY_SCOPE, SEARCH_SCOPE]) {
      expect(reaches(scope, plain)).toBe(true);
      expect(reaches(scope, changed('.atlas/types/task.md'))).toBe(true);
      expect(scopeTouched(scope, UNKNOWN_NEWS)).toBe(true);
    }
  });
});

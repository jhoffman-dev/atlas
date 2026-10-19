import { describe, expect, it } from 'vitest';
import { AREA_TYPE, FILED_UNDER_TYPES, PERSON_TYPE, type NoteChange } from '@atlas/domain';
import {
  INBOX_CHOICES_SCOPE,
  INBOX_SCOPE,
  MENTIONS_SCOPE,
  notePaneScope,
  PEOPLE_SCOPE,
  PERSON_EMAILS_SCOPE,
  PROJECTS_SCOPE,
  REVIEW_SCOPE,
  scopeTouched,
  UNKNOWN_NEWS,
  type IndexNews,
  type PaneNote,
  type ReadScope,
} from './scoped-reads.ts';

/**
 * Attack on PR #390 (#325): a pane reader that is not read again for news of
 * what it shows shows stale data. Each test is one invariant: the change named
 * reaches the reader that shows it.
 */

const changed = (path: string, type: string | null = null, extra: Partial<NoteChange> = {}) =>
  ({ kind: 'changed', path, type, digest: 'b', before: 'a', ...extra }) as NoteChange;
const added = (path: string, type: string | null = null) =>
  ({ kind: 'added', path, type, digest: 'a' }) as NoteChange;
const removed = (path: string, type: string | null = null) =>
  ({ kind: 'removed', path, type, digest: 'a' }) as NoteChange;

const news = (changes: NoteChange[], facets: IndexNews['facets'] = new Set()): IndexNews => ({
  changes,
  facets,
});
const reaches = (scope: ReadScope, ...changes: NoteChange[]) => scopeTouched(scope, news(changes));

const plain = (body: string, more: Partial<PaneNote> = {}): PaneNote => ({
  path: 'Notes/Journal.md',
  frontmatter: null,
  properties: {},
  originalBody: body,
  doc: { content: [{ type: 'paragraph' }] },
  ...more,
});

/** "Café" as a keyboard types it (NFC), and as a Cocoa app may write its file name (NFD). */
const CAFE_TYPED = 'Café';
const CAFE_ON_DISK = 'Café';

describe('attack-390: the note pane hears a change to a note it links to or embeds', () => {
  it('hears its embed’s source note when the file name on disk is decomposed (NFD) and the link composed (NFC)', () => {
    // resolveWikiLinkTarget composes both sides, so `![[Café#^p1]]` shows Café.md's
    // block whichever form its file name has; the scope must hear it in either form too.
    const scope = notePaneScope(plain(`Plans: ![[${CAFE_TYPED}#^p1]]`), 'Notes/Journal.md');
    expect(reaches(scope, changed(`Places/${CAFE_ON_DISK}.md`))).toBe(true);
  });

  it('hears its embed’s source note when the link is decomposed and the file name composed', () => {
    const scope = notePaneScope(plain(`Plans: ![[${CAFE_ON_DISK}#^p1]]`), 'Notes/Journal.md');
    expect(reaches(scope, changed(`Places/${CAFE_TYPED}.md`))).toBe(true);
  });

  it('hears a link target renamed away (its old path removed)', () => {
    const scope = notePaneScope(plain('See [[Plans]].'), 'Notes/Journal.md');
    expect(reaches(scope, removed('Plans.md'), added('Summer plans.md'))).toBe(true);
  });

  it('hears an embed’s source moved to another folder', () => {
    const scope = notePaneScope(plain('![[Plans#^p1]]'), 'Notes/Journal.md');
    expect(reaches(scope, removed('Plans.md'), added('Archive/Plans.md'))).toBe(true);
  });

  it('hears a note made with the name of a link that pointed at nothing', () => {
    const scope = notePaneScope(plain('See [[Someday]].'), 'Notes/Journal.md');
    expect(reaches(scope, added('Later/Someday.md'))).toBe(true);
  });

  it('hears a link written by path, aliased and to a heading, by the note’s name', () => {
    const scope = notePaneScope(plain('[[Trips/Plans.md#Tent|the tent]]'), 'Notes/Journal.md');
    expect(reaches(scope, changed('Elsewhere/plans.md'))).toBe(true);
  });

  it('hears its own note moved or deleted outside the app', () => {
    const scope = notePaneScope(plain('Nothing linked.'), 'Notes/Journal.md');
    expect(reaches(scope, removed('Notes/Journal.md'))).toBe(true);
  });

  it('hears its own note retyped: a typed note reads for any note after it', () => {
    const scope = notePaneScope(plain('', { properties: { type: 'task' } }), 'Notes/Journal.md');
    expect(reaches(scope, changed('Anything/else.md'))).toBe(true);
  });

  it('does not hear an unrelated note (the point of the PR)', () => {
    const scope = notePaneScope(plain('See [[Plans]].'), 'Notes/Journal.md');
    expect(reaches(scope, changed('Elsewhere.md'))).toBe(false);
  });
});

describe('attack-390: Today and the weekly review hear what their rows show', () => {
  it('hears an area note, which a task is filed under and Today groups next actions by', () => {
    // Today's next actions are grouped by the task's `project` relation and labelled
    // by that note's title (`compileReviewTasksQuery`), and an area is a note a task
    // is filed under (FILED_UNDER_TYPES). Its retitle, rename or deletion moves the
    // group, but no task's digest changes.
    expect(FILED_UNDER_TYPES).toContain(AREA_TYPE);
    expect(reaches(REVIEW_SCOPE, changed('Areas/Garden.md', AREA_TYPE))).toBe(true);
  });

  it('hears an area note deleted, which leaves its tasks filed under nothing', () => {
    expect(reaches(REVIEW_SCOPE, removed('Areas/Garden.md', AREA_TYPE))).toBe(true);
  });

  it('hears a task become due, done, deferred or waiting (it is a task changed)', () => {
    expect(reaches(REVIEW_SCOPE, changed('Tasks/Call the bank.md', 'task'))).toBe(true);
  });

  it('hears a project retitled or moved', () => {
    expect(reaches(REVIEW_SCOPE, removed('Projects/Atlas.md', 'project'))).toBe(true);
  });

  it('hears a task that stops being a task (it leaves the list)', () => {
    expect(
      reaches(REVIEW_SCOPE, changed('Tasks/Call the bank.md', null, { beforeType: 'task' })),
    ).toBe(true);
  });
});

describe('attack-390: the Inbox’s rows hear what their pickers show', () => {
  it('hears a project moved, whose path an Inbox task’s `project` relation resolves to', () => {
    // A row's "File under" picker shows `task.project`, the relation's resolved
    // path, read with the list. Moving the project re-resolves the relation in the
    // index without changing the task's bytes, so only the project's news says so.
    const moved = [
      removed('Projects/Atlas.md', 'project'),
      added('Projects/Active/Atlas.md', 'project'),
    ];
    expect(reaches(INBOX_SCOPE, ...moved)).toBe(true);
  });

  it('hears an area moved, which an Inbox task is filed under', () => {
    const moved = [
      removed('Areas/Garden.md', AREA_TYPE),
      added('Areas/Outdoors/Garden.md', AREA_TYPE),
    ];
    expect(reaches(INBOX_SCOPE, ...moved)).toBe(true);
  });

  it('hears a person moved, whose path a waiting Inbox task’s `waiting_on` resolves to', () => {
    const moved = [
      removed('People/Mara Quill.md', PERSON_TYPE),
      added('People/Old/Mara Quill.md', PERSON_TYPE),
    ];
    expect(reaches(INBOX_SCOPE, ...moved)).toBe(true);
  });

  it('hears a note dropped into the Inbox folder, at any depth, of any type', () => {
    expect(reaches(INBOX_SCOPE, added('inbox/Clip/Recipe.md'))).toBe(true);
  });

  it('hears a note filed out of the Inbox: a removal is where it was', () => {
    expect(reaches(INBOX_SCOPE, removed('Inbox/Recipe.md'))).toBe(true);
  });

  it('offers again the projects, areas and people when one changes', () => {
    expect(reaches(INBOX_CHOICES_SCOPE, changed('Areas/Garden.md', AREA_TYPE))).toBe(true);
    expect(reaches(INBOX_CHOICES_SCOPE, changed('People/Mara Quill.md', PERSON_TYPE))).toBe(true);
  });
});

describe('attack-390: the window’s readers of a type', () => {
  it('reads the people again when a person note’s emails change', () => {
    expect(reaches(PERSON_EMAILS_SCOPE, changed('People/Mara Quill.md', 'person'))).toBe(true);
  });

  it('reads the people again when a note stops being a person', () => {
    const left = changed('People/Mara Quill.md', null, { beforeType: 'person' });
    expect(reaches(PEOPLE_SCOPE, left)).toBe(true);
    expect(reaches(PERSON_EMAILS_SCOPE, left)).toBe(true);
  });

  it('reads the people again for a note of two types, one of them person, written with spaces', () => {
    expect(reaches(PEOPLE_SCOPE, changed('People/Mara Quill.md', 'company, Person'))).toBe(true);
  });

  it('reads the projects again when a project is archived (moved into the Archive)', () => {
    const archived = [
      removed('Projects/Atlas.md', 'project'),
      added('Archive/Projects/Atlas.md', 'project'),
    ];
    expect(reaches(PROJECTS_SCOPE, ...archived)).toBe(true);
  });

  it('reads the mentions again for a mention added in any note', () => {
    expect(reaches(MENTIONS_SCOPE, changed('Anywhere/at all.md'))).toBe(true);
  });

  it('reads every named scope again for news whose notes are not known', () => {
    for (const scope of [
      INBOX_SCOPE,
      REVIEW_SCOPE,
      INBOX_CHOICES_SCOPE,
      PEOPLE_SCOPE,
      PROJECTS_SCOPE,
      PERSON_EMAILS_SCOPE,
      MENTIONS_SCOPE,
      notePaneScope(plain('nothing'), 'Notes/Journal.md'),
    ]) {
      expect(scopeTouched(scope, UNKNOWN_NEWS)).toBe(true);
    }
  });
});

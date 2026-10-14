import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  mergedRecord,
  MIGRATION_RECORD_PATH,
  MigrationRecordError,
  migrationRecordText,
  parseMigrationRecord,
  recordGoneOnFrom,
  recordHasWorkLeft,
  undoStillOffered,
  type MigrationRecord,
} from './migration-record.ts';

/** P30-02: the record one undo is made from. */
const TASK = createVaultPath('tasks/Call.md');
const RECORD: MigrationRecord = {
  at: '2026-10-08T09:30:00',
  files: [
    {
      kind: 'changed',
      path: TASK,
      before: '---\ntype: task\nstatus: "done"   # kept\n---\n',
      after: '---\ntype: task\nstatus: archive\ncompleted: 2026-09-30\n---\n',
    },
    {
      kind: 'created',
      path: createVaultPath('.atlas/views/Next actions.md'),
      contents: '---\natlas: view\n---\n\n# Next actions\n```\n',
    },
  ],
  finished: true,
  left: [TASK],
};

const withFiles = (files: unknown) =>
  migrationRecordText(RECORD).replace(
    /\n```json\n.*\n```/,
    `\n\`\`\`json\n${JSON.stringify({ at: RECORD.at, files })}\n\`\`\``,
  );

describe('the migration record', () => {
  it('reads back exactly what it was written with, backticks and comments included', () => {
    expect(parseMigrationRecord(migrationRecordText(RECORD))).toEqual(RECORD);
  });

  it('says what it is to a person who opens it', () => {
    expect(migrationRecordText(RECORD)).toContain('# Task statuses moved to GTD');
    expect(migrationRecordText(RECORD)).toContain('2 files were changed or added');
  });

  it.each([
    ['no list of files', '---\natlas: migration\n---\n\nHello\n'],
    ['a list that is not JSON', '---\natlas: migration\n---\n\n```json\n{nope\n```\n'],
    ['no time', '---\natlas: migration\n---\n\n```json\n{"files":[]}\n```\n'],
  ])('refuses a record with %s', (_what, text) => {
    expect(() => parseMigrationRecord(text)).toThrow(MigrationRecordError);
  });

  it.each([
    ['a path out of the vault', { kind: 'created', path: '../outside.md', contents: '' }],
    ['no path', { kind: 'created', contents: '' }],
    ['itself', { kind: 'created', path: MIGRATION_RECORD_PATH, contents: '' }],
    [
      'itself, spelled in another case',
      { kind: 'created', path: MIGRATION_RECORD_PATH.toUpperCase(), contents: '' },
    ],
    [
      'a “before” that is not a frontmatter block',
      { kind: 'changed', path: 'a.md', before: 'rm -rf', after: '---\na: 1\n---\n' },
    ],
    [
      'a block with a body after it',
      { kind: 'changed', path: 'a.md', before: '---\na: 1\n---\nbody', after: '---\na: 1\n---\n' },
    ],
    ['a kind it never writes', { kind: 'moved', path: 'a.md' }],
  ])('refuses a file that names %s', (_what, file) => {
    expect(() => parseMigrationRecord(withFiles([file]))).toThrow(MigrationRecordError);
  });
});

describe('undoStillOffered (#163)', () => {
  it('offers the undo for a week from the day the run began, and not after', () => {
    expect(undoStillOffered(RECORD, '2026-10-08')).toBe(true);
    expect(undoStillOffered(RECORD, '2026-10-14')).toBe(true);
    expect(undoStillOffered(RECORD, '2026-10-15')).toBe(false);
    expect(undoStillOffered(RECORD, '2027-01-01')).toBe(false);
  });

  it('offers it on a day before the run, as a Mac in an earlier timezone sees a synced record', () => {
    expect(undoStillOffered(RECORD, '2026-10-07')).toBe(true);
  });

  it('ends once dismissed, whatever the day', () => {
    expect(undoStillOffered({ ...RECORD, undoDismissed: true }, '2026-10-08')).toBe(false);
  });

  it('measures the week from the latest run, once one went on from a run cut off partway', () => {
    const later = { ...RECORD, lastRunAt: '2026-10-20T08:00:00' };
    expect(undoStillOffered(later, '2026-10-26')).toBe(true);
    expect(undoStillOffered(later, '2026-10-27')).toBe(false);
  });

  it('has ended for a record whose day cannot be read', () => {
    expect(undoStillOffered({ ...RECORD, at: 'some time' }, '2026-10-08')).toBe(false);
  });

  it('keeps the dismissal and the latest run through the file', () => {
    const kept = { ...RECORD, lastRunAt: '2026-10-09T10:00:00', undoDismissed: true };
    expect(parseMigrationRecord(migrationRecordText(kept))).toEqual(kept);
  });
});

describe('recordGoneOnFrom (#163)', () => {
  it('goes on from a run cut off partway, or one that left files to move', () => {
    const cutOff = { ...RECORD, finished: false, left: [] };
    expect(recordGoneOnFrom(cutOff)).toBe(cutOff);
    expect(recordGoneOnFrom(RECORD)).toBe(RECORD);
  });

  it('starts afresh after a run that is over: none, finished with nothing left, or dismissed', () => {
    expect(recordGoneOnFrom(null)).toBeNull();
    expect(recordGoneOnFrom({ ...RECORD, left: [] })).toBeNull();
    expect(recordGoneOnFrom({ ...RECORD, undoDismissed: true })).toBeNull();
    expect(recordGoneOnFrom({ ...RECORD, finished: false, undoDismissed: true })).toBeNull();
  });
});

describe('recordHasWorkLeft', () => {
  it('is true while the last run stopped partway or left a file, and false once it moved everything', () => {
    expect(recordHasWorkLeft(RECORD)).toBe(true);
    expect(recordHasWorkLeft({ ...RECORD, left: [] })).toBe(false);
    expect(recordHasWorkLeft({ ...RECORD, finished: false, left: [] })).toBe(true);
    expect(recordHasWorkLeft({ at: RECORD.at, files: [] })).toBe(true);
  });

  it('reads an unfinished run from a record that does not say', () => {
    const silent = migrationRecordText(RECORD).replace(/,"finished":true,"left":\[[^\]]*\]/, '');
    expect(parseMigrationRecord(silent)).toMatchObject({ finished: false, left: [] });
  });
});

describe('mergedRecord', () => {
  it('is the later run alone when there was none before', () => {
    expect(mergedRecord(null, RECORD)).toBe(RECORD);
  });

  const FIRST = RECORD.files[0]!.kind === 'changed' ? RECORD.files[0]! : null;

  it('keeps what a file was before the first run, while it still held what the first wrote', () => {
    const later: MigrationRecord = {
      at: '2026-10-08T10:00:00',
      files: [
        { kind: 'changed', path: TASK, before: FIRST!.after, after: '---\nlast: 1\n---\n' },
        { kind: 'created', path: createVaultPath('.atlas/views/Waiting.md'), contents: 'w' },
      ],
    };
    const merged = mergedRecord(RECORD, later);
    expect(merged.at).toBe(RECORD.at);
    expect(merged.files).toEqual([
      { kind: 'changed', path: TASK, before: FIRST!.before, after: '---\nlast: 1\n---\n' },
      RECORD.files[1],
      later.files[1],
    ]);
  });

  it('takes what the second run found, when the first never wrote the file or it changed since', () => {
    // Keeping the first run's "before" here would undo an edit made between the runs (adversarial pass).
    const later: MigrationRecord = {
      at: '2026-10-08T10:00:00',
      files: [
        { kind: 'changed', path: TASK, before: '---\nmid: 1\n---\n', after: '---\nlast: 1\n---\n' },
      ],
    };
    expect(mergedRecord(RECORD, later).files[0]).toEqual(later.files[0]);
  });

  it('records a file both runs made as the later one made it, so undo takes away what is there', () => {
    const made = RECORD.files[1]!;
    const again = { kind: 'created' as const, path: made.path, contents: 'made again\n' };
    expect(mergedRecord(RECORD, { at: 'later', files: [again] }).files[1]).toEqual(again);
  });

  it('offers the later run for undo afresh: a dismissal of the first does not carry over (#163)', () => {
    const merged = mergedRecord(
      { ...RECORD, undoDismissed: true },
      { at: '2026-10-20T08:00:00', files: [] },
    );
    expect(merged.at).toBe(RECORD.at);
    expect(merged.lastRunAt).toBe('2026-10-20T08:00:00');
    expect(undoStillOffered(merged, '2026-10-21')).toBe(true);
  });

  it('keeps a file the first run made as made', () => {
    const made = RECORD.files[1]!;
    const later: MigrationRecord = {
      at: 'later',
      files: [
        { kind: 'changed', path: made.path, before: '---\na: 1\n---\n', after: '---\na: 2\n---\n' },
      ],
    };
    expect(mergedRecord(RECORD, later).files[1]).toEqual(made);
  });
});

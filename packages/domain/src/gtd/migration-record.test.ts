import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  mergedRecord,
  MIGRATION_RECORD_PATH,
  MigrationRecordError,
  migrationRecordText,
  parseMigrationRecord,
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

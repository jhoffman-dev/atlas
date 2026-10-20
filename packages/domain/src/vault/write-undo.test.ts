import { describe, expect, it } from 'vitest';
import { createVaultPath } from './vault-path.ts';
import { writeUndo, type WriteRecord } from './write-undo.ts';

/** #320: what taking one write back does, judged from the file as it is now. */
const PATH = createVaultPath('Tasks/Send the Larkspur invoice.md');
const BEFORE =
  '---\nstatus: "Next"  # kept as typed\ndue: 2026-10-21\n---\nCall Mara Quill first.\r\n';
const AFTER =
  '---\nstatus: Done\ndue: 2026-10-21\ncompleted: 2026-10-20\n---\nCall Mara Quill first.\r\n';
const record: WriteRecord = { path: PATH, before: BEFORE, after: AFTER };

describe('writeUndo', () => {
  it('puts back the exact bytes the write replaced while the file is as the write left it', () => {
    expect(writeUndo({ record, now: AFTER })).toEqual({ kind: 'restore', contents: BEFORE });
  });

  it('has nothing to do when the file already holds what it held before', () => {
    expect(writeUndo({ record, now: BEFORE })).toEqual({ kind: 'already' });
  });

  it('refuses, naming the properties, when the frontmatter moved on since', () => {
    const now = AFTER.replace('status: Done', 'status: Waiting');
    expect(writeUndo({ record, now })).toEqual({ kind: 'changed', part: 'frontmatter' });
  });

  it('refuses, naming the text, when only the body was edited since', () => {
    const now = `${AFTER}Tobias Fenn replied.\n`;
    expect(writeUndo({ record, now })).toEqual({ kind: 'changed', part: 'body' });
  });

  it('tells one byte apart: a line ending changed since is a change', () => {
    const now = AFTER.replace('\r\n', '\n');
    expect(writeUndo({ record, now })).toEqual({ kind: 'changed', part: 'body' });
  });

  it('takes a note back to having no frontmatter at all when the write gave it its first', () => {
    const bare = {
      path: PATH,
      before: 'Just words.\n',
      after: '---\nstatus: Inbox\n---\nJust words.\n',
    };
    expect(writeUndo({ record: bare, now: bare.after })).toEqual({
      kind: 'restore',
      contents: 'Just words.\n',
    });
  });
});

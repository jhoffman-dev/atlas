/**
 * Adversarial pass on #376 (#284), end to end: the application's writes
 * (saveNote, setNoteProperty / writeFrontmatterChanges for boards and
 * queries, clarify) run against the real markdown adapter and an in-memory
 * vault, on a note whose frontmatter lists a key twice.
 *
 * A refused change leaves the file byte for byte as it was and the refusal
 * reaches the caller. A change the writer lets through must still be held to
 * the task rules (ADR-0029) — which judge it against the properties the note
 * is read with, and the reader reads such a block as `{}`.
 */
import { describe, expect, it } from 'vitest';
import {
  clarifyInboxItem,
  ClarifyRefusedError,
  fakeIndexPort,
  fakeVaultFs,
  FrontmatterRefusedError,
  memoryVault,
  openNote,
  saveNote,
  setNoteProperty,
  writeFrontmatterChanges,
  type ArchivePorts,
} from '@dfai/application';
import { createVaultPath } from '@dfai/domain';
import { remarkMarkdown } from './markdown-port.ts';

const TODAY = '2026-10-18';
const NOTE = 'Tasks/Water the ferns.md';
const markdown = remarkMarkdown;

/** A vault holding one note, and every write made to it. */
function vault(text: string) {
  const memory = memoryVault({ [NOTE]: text });
  const writes: string[] = [];
  const fs = fakeVaultFs({
    ...memory.fs,
    writeTextFile: async (write) => {
      writes.push(write.path);
      return memory.fs.writeTextFile(write);
    },
  });
  return { fs, writes, text: () => memory.files.get(NOTE) };
}

const note = (...lines: string[]) => `---\n${lines.join('\n')}\n---\n\nKeep the soil damp.\n`;

describe('#376 a refused change writes nothing and reaches the caller', () => {
  const DUPLICATED = note('type: task', 'status: next-action', 'tags: [home]', 'tags: [garden]');

  it('setNoteProperty (a table cell, a board move) on the duplicated key', async () => {
    const v = vault(DUPLICATED);
    await expect(
      setNoteProperty({ fs: v.fs, markdown, path: NOTE, key: 'tags', value: ['x'], today: TODAY }),
    ).rejects.toThrow(FrontmatterRefusedError);
    expect(v.writes).toEqual([]);
    expect(v.text()).toBe(DUPLICATED);
  });

  it('writeFrontmatterChanges (types, settings) on the duplicated key', async () => {
    const v = vault(DUPLICATED);
    await expect(
      writeFrontmatterChanges({ fs: v.fs, markdown, path: NOTE, values: { tags: null } }),
    ).rejects.toMatchObject({ name: 'FrontmatterRefusedError', key: 'tags' });
    expect(v.writes).toEqual([]);
    expect(v.text()).toBe(DUPLICATED);
  });

  it('saveNote with a property change to the duplicated key: body edits are not written either', async () => {
    const v = vault(DUPLICATED);
    const opened = await openNote({ fs: v.fs, markdown, path: createVaultPath(NOTE) });
    await expect(
      saveNote({
        fs: v.fs,
        markdown,
        note: opened,
        doc: opened.doc,
        changes: { values: { tags: ['x'] }, today: TODAY },
      }),
    ).rejects.toMatchObject({ name: 'FrontmatterRefusedError', key: 'tags' });
    expect(v.writes).toEqual([]);
    expect(v.text()).toBe(DUPLICATED);
  });

  it('clarify refuses a note whose block lists a key twice, writing nothing', async () => {
    const path = createVaultPath('Inbox/Call the plumber.md');
    const captured = note('type: task', 'status: inbox', 'tags: [home]', 'tags: [garden]');
    const memory = memoryVault({ [path]: captured });
    const writes: string[] = [];
    const ports: ArchivePorts = {
      fs: fakeVaultFs({
        ...memory.fs,
        writeTextFile: async (write) => {
          writes.push(write.path);
          return memory.fs.writeTextFile(write);
        },
      }),
      markdown,
      index: fakeIndexPort(),
      editors: {
        state: () => 'closed',
        flush: async () => {},
        follow: () => {},
        abandon: () => {},
        reload: () => {},
      },
    };
    await expect(
      clarifyInboxItem({
        ports,
        path,
        clarification: { status: 'next-action' },
        notePaths: [path],
        today: TODAY,
      }),
    ).rejects.toThrow(ClarifyRefusedError);
    expect(writes).toEqual([]);
    expect(memory.files.get(path)).toBe(captured);
  });
});

/**
 * The writer now lets a change to another key through, but every caller
 * judges the task rules against `frontmatterProperties`, which is `{}` for
 * this block: the note is not seen as a task, nor as finished, nor as
 * repeating. Before #376 the writer threw, so nothing was written; now a
 * write goes through that the rules would never have made.
 */
describe.each([
  ['a block that lists `tags` twice', ['tags: [home]', 'tags: [garden]']],
  ['a clean block (control)', ['tags: [home]']],
])('#376 a change the writer lets through is held to the task rules: %s', (_, tags) => {
  /** Whether the note was left alone, or the write carries what the rules add. */
  const outcome = (before: string, after: string | undefined, rule: (text: string) => boolean) =>
    after === before ? 'left alone' : rule(after ?? '') ? 'held to the rules' : after;
  const RULED = ['left alone', 'held to the rules'];

  it('finishing a task from a board stamps `completed`, or writes nothing', async () => {
    const before = note('type: task', 'status: next-action', ...tags);
    const v = vault(before);
    await setNoteProperty({
      fs: v.fs,
      markdown,
      path: NOTE,
      key: 'status',
      value: 'archive',
      today: TODAY,
    }).catch(() => undefined);
    expect(RULED).toContain(
      outcome(before, v.text(), (text) => text.includes('\ncompleted: 2026-10-18\n')),
    );
  });

  it('ticking a repeating task done rolls it forward, or writes nothing: the series never ends', async () => {
    const before = note(
      'type: task',
      'status: next-action',
      'recurrence: weekly',
      'due: 2026-10-14',
      ...tags,
    );
    const v = vault(before);
    await setNoteProperty({
      fs: v.fs,
      markdown,
      path: NOTE,
      key: 'status',
      value: 'archive',
      today: TODAY,
      completion: { statusKey: 'status', doneValue: 'archive', resetStatus: 'next-action' },
    }).catch(() => undefined);
    expect(RULED).toContain(
      outcome(
        before,
        v.text(),
        (text) => text.includes('\ndue: 2026-10-21\n') && !text.includes('status: archive'),
      ),
    );
  });

  it('reopening a finished task from the pane clears `completed`, or writes nothing', async () => {
    const before = note('type: task', 'status: archive', 'completed: 2026-09-01', ...tags);
    const v = vault(before);
    const opened = await openNote({ fs: v.fs, markdown, path: createVaultPath(NOTE) });
    await saveNote({
      fs: v.fs,
      markdown,
      note: opened,
      doc: opened.doc,
      changes: { values: { status: 'next-action' }, today: TODAY },
    }).catch(() => undefined);
    expect(RULED).toContain(outcome(before, v.text(), (text) => !text.includes('completed:')));
  });
});

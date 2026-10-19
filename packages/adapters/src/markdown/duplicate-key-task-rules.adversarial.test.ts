/**
 * #376 verification: on a block that lists a key twice, every write held to
 * the task rules (ADR-0029) judges the note as the writer reads it — a chat
 * proposal included, whose preview is the text Accept writes. And a block
 * that lists a key the rules themselves read (`type`, `status`, `completed`,
 * `recurrence`, `due`) refuses such a write: which copy the rules should
 * judge cannot be told. Real markdown adapter, in-memory vault.
 */
import { describe, expect, it } from 'vitest';
import {
  acceptProposal,
  apiFixture,
  createChatToolbox,
  fakeVaultFs,
  memoryVault,
  openNote,
  ProposalRefused,
  proposeEdit,
  saveNote,
  setNoteProperty,
} from '@atlas/application';
import { createVaultPath } from '@atlas/domain';
import { remarkMarkdown as markdown } from './markdown-port.ts';

const TODAY = '2026-10-18';
const NOTE = 'Tasks/Water the ferns.md';
const note = (...lines: string[]) => `---\n${lines.join('\n')}\n---\n\nKeep the soil damp.\n`;
const twice = (key: string) =>
  `This note's properties list "${key}" twice; fix it in the source before changing it.`;

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

const OPEN_NOTES = { state: () => 'closed' as const, reload: () => {} };

describe('#376 a chat proposal on a block listing an unrelated key twice', () => {
  it('reopening a finished task clears `completed`, as Accept writes it', async () => {
    const before = note(
      'type: task',
      'status: archive',
      'completed: 2026-10-01',
      'tags: [a]',
      'tags: [b]',
    );
    const v = vault(before);
    const proposal = await proposeEdit({
      fs: v.fs,
      markdown,
      input: { path: NOTE, properties: { status: 'next-action' } },
      id: 'p1',
      today: TODAY,
    });
    await acceptProposal({ fs: v.fs, openNotes: OPEN_NOTES, proposal });
    expect(v.text()).toBe(note('type: task', 'status: next-action', 'tags: [a]', 'tags: [b]'));
  });
});

describe('#376 a block listing a key the task rules read refuses a ruled write', () => {
  it('`type` twice: a board move to Archive is refused, nothing written', async () => {
    const before = note('type: note', 'status: next-action', 'type: task');
    const v = vault(before);
    await expect(
      setNoteProperty({
        fs: v.fs,
        markdown,
        path: NOTE,
        key: 'status',
        value: 'archive',
        today: TODAY,
        completion: { statusKey: 'status', doneValue: 'archive', resetStatus: 'next-action' },
      }),
    ).rejects.toMatchObject({
      name: 'FrontmatterRefusedError',
      key: 'type',
      message: twice('type'),
    });
    expect(v.writes).toEqual([]);
    expect(v.text()).toBe(before);
  });

  it('`status` twice: a tick is refused, nothing written', async () => {
    const before = note('type: task', 'status: next-action', 'tags: [a]', 'status: waiting');
    const v = vault(before);
    await expect(
      setNoteProperty({
        fs: v.fs,
        markdown,
        path: NOTE,
        key: 'status',
        value: 'archive',
        today: TODAY,
      }),
    ).rejects.toMatchObject({ name: 'FrontmatterRefusedError', key: 'status' });
    expect(v.writes).toEqual([]);
  });

  it('`due` twice: a change to another key from the pane is refused, body and all', async () => {
    const before = note(
      'type: task',
      'recurrence: weekly',
      'due: 2026-10-14',
      'title: T',
      'due: 2026-10-21',
    );
    const v = vault(before);
    const opened = await openNote({ fs: v.fs, markdown, path: createVaultPath(NOTE) });
    await expect(
      saveNote({
        fs: v.fs,
        markdown,
        note: opened,
        doc: opened.doc,
        changes: { values: { title: 'U' }, today: TODAY },
      }),
    ).rejects.toMatchObject({ name: 'FrontmatterRefusedError', key: 'due' });
    expect(v.writes).toEqual([]);
  });

  it('`completed` twice: a chat proposal is refused before it is shown, in words for the model', async () => {
    const before = note(
      'type: task',
      'status: archive',
      'completed: 2026-10-01',
      'completed: 2026-10-02',
    );
    const v = vault(before);
    await expect(
      proposeEdit({
        fs: v.fs,
        markdown,
        input: { path: NOTE, properties: { status: 'next-action' } },
        id: 'p1',
        today: TODAY,
      }),
    ).rejects.toThrow(new ProposalRefused(twice('completed')));
  });

  it('`recurrence` twice: a repeating task ticked done from a board is refused, nothing written', async () => {
    // The roll writes `due`, `status` and `lastCompleted`, none of them listed
    // twice: only the rules' own read can refuse it.
    const before = note(
      'type: task',
      'status: next-action',
      'recurrence: weekly',
      'due: 2026-10-14',
      'recurrence: monthly',
    );
    const v = vault(before);
    await expect(
      setNoteProperty({
        fs: v.fs,
        markdown,
        path: NOTE,
        key: 'status',
        value: 'archive',
        today: TODAY,
        completion: { statusKey: 'status', doneValue: 'archive', resetStatus: 'next-action' },
      }),
    ).rejects.toMatchObject({ name: 'FrontmatterRefusedError', key: 'recurrence' });
    expect(v.writes).toEqual([]);
    expect(v.text()).toBe(before);
  });

  it('`completed` twice: finishing the task is refused, though the writer would let `status` change', async () => {
    const before = note(
      'type: task',
      'status: next-action',
      'completed: 2026-10-01',
      'completed: 2026-10-02',
    );
    const v = vault(before);
    await expect(
      setNoteProperty({
        fs: v.fs,
        markdown,
        path: NOTE,
        key: 'status',
        value: 'archive',
        today: TODAY,
      }),
    ).rejects.toMatchObject({ name: 'FrontmatterRefusedError', key: 'completed' });
    expect(v.writes).toEqual([]);
  });

  it('a key the rules do not read, listed twice, still lets the write through', async () => {
    const before = note('type: task', 'status: next-action', 'tags: [a]', 'tags: [b]');
    const v = vault(before);
    await setNoteProperty({
      fs: v.fs,
      markdown,
      path: NOTE,
      key: 'status',
      value: 'archive',
      today: TODAY,
    });
    expect(v.text()).toBe(
      note('type: task', 'status: archive', 'tags: [a]', 'tags: [b]', `completed: ${TODAY}`),
    );
  });
});

describe('#376 the chat toolbox, on a block that refuses the edit', () => {
  const box = (text: string) => {
    const fixture = apiFixture({ files: { [NOTE]: text }, markdown });
    return createChatToolbox({ api: fixture.deps, fs: fixture.fs, markdown, newId: () => 'p1' });
  };

  it('answers propose_edit with the reason as a tool error, and the turn goes on', async () => {
    const before = note(
      'type: task',
      'status: archive',
      'completed: 2026-10-01',
      'completed: 2026-10-02',
    );
    const outcome = await box(before).run({
      id: 'c1',
      name: 'propose_edit',
      input: { path: NOTE, properties: { status: 'next-action' } },
    });
    expect(outcome).toEqual({
      proposal: null,
      result: { callId: 'c1', name: 'propose_edit', content: twice('completed'), isError: true },
    });
  });

  it('answers a change to a duplicated key the writer refuses the same way', async () => {
    const before = note('type: note', 'tags: [a]', 'tags: [b]');
    const outcome = await box(before).run({
      id: 'c2',
      name: 'propose_edit',
      input: { path: NOTE, properties: { tags: ['c'] } },
    });
    expect(outcome.result).toEqual({
      callId: 'c2',
      name: 'propose_edit',
      content: twice('tags'),
      isError: true,
    });
  });
});

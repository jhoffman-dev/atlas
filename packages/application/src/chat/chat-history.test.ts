import { describe, expect, it } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import { apiFixture } from '../testing/api-fixture.ts';
import { listChats, readChat, recordChatEntries, type ChatHeader } from './chat-history.ts';

const HEADER: ChatHeader = {
  created: '2026-09-27 10:04',
  model: 'claude-opus-5-5',
  context: 'Plan',
  firstMessage: 'Summarize this page please',
};

describe('recordChatEntries', () => {
  it('makes Chats/ and a note named for the question on the first turn', async () => {
    const { fs, files } = apiFixture({ files: { 'Plan.md': 'x' } });
    const record = await recordChatEntries({
      fs,
      record: null,
      header: HEADER,
      entries: [{ role: 'user', text: 'Summarize this page please' }],
      notePaths: [],
    });
    expect(record.path).toBe('Chats/Summarize this page please.md');
    expect(files.get(record.path)?.text).toBe(
      '---\ntype: chat\ncreated: "2026-09-27 10:04"\nmodel: "claude-opus-5-5"\ncontext: "[[Plan]]"\n---\n\n' +
        '## You\n\nSummarize this page please\n',
    );
  });

  it('numbers a second chat that starts the same way', async () => {
    const { fs } = apiFixture({ files: { 'Chats/Summarize this page please.md': 'old' } });
    const record = await recordChatEntries({
      fs,
      record: null,
      header: HEADER,
      entries: [],
      notePaths: [createVaultPath('Chats/Summarize this page please.md')],
    });
    expect(record.path).toBe('Chats/Summarize this page please 2.md');
  });

  it('appends later turns to the note as it is now, keeping what the person changed', async () => {
    const { fs, files } = apiFixture({ files: { 'Chats/Q.md': '## You\n\nQ\n' } });
    await fs.writeTextFile({
      path: createVaultPath('Chats/Q.md'),
      contents: '## You\n\nQ  (my own note)\n',
      expectedModified: null,
    });
    const record = { path: createVaultPath('Chats/Q.md') };
    const again = await recordChatEntries({
      fs,
      record,
      header: HEADER,
      entries: [{ role: 'assistant', text: 'A', activity: ['Read Plan'] }],
      notePaths: [],
    });
    expect(again).toBe(record);
    expect(files.get('Chats/Q.md')?.text).toBe(
      '## You\n\nQ  (my own note)\n\n## Claude\n\nA\n\n> Read Plan\n',
    );
  });

  it('starts a new note when the old one has gone', async () => {
    const { fs } = apiFixture({ files: {} });
    const record = await recordChatEntries({
      fs,
      record: { path: createVaultPath('Chats/Deleted.md') },
      header: HEADER,
      entries: [],
      notePaths: [],
    });
    expect(record.path).toBe('Chats/Summarize this page please.md');
  });
});

describe('listChats and readChat', () => {
  it('lists nothing in a vault with no Chats folder', async () => {
    expect(await listChats({ fs: apiFixture({ files: { 'A.md': 'a' } }).fs })).toEqual([]);
  });

  it('lists chats newest first, and reads one back', async () => {
    const fixture = apiFixture({
      files: {
        'Chats/Alpha.md': '## You\n\nfirst\n',
        'Chats/Beta.md': '---\ntype: chat\n---\n## You\n\nHi\n\n## Claude\n\nHello.\n',
        'Chats/picture.png': 'not a note',
      },
    });
    const modified: Record<string, number> = { 'Chats/Alpha.md': 10, 'Chats/Beta.md': 20 };
    const fs = {
      ...fixture.fs,
      listDirectory: async (folder: Parameters<typeof fixture.fs.listDirectory>[0]) =>
        (await fixture.fs.listDirectory(folder)).map((entry) =>
          entry.kind === 'file' ? { ...entry, modified: modified[entry.path] ?? 0 } : entry,
        ),
    };
    const chats = await listChats({ fs });
    expect(chats.map((chat) => chat.title)).toEqual(['Beta', 'Alpha']);
    expect(await readChat({ fs, path: createVaultPath('Chats/Beta.md') })).toEqual([
      { role: 'user', text: 'Hi' },
      { role: 'assistant', text: 'Hello.' },
    ]);
  });
});

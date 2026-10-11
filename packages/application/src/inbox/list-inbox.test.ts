import { describe, expect, it } from 'vitest';
import { fakeIndexPort, fakeMarkdown } from '../testing/fake-ports.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';
import { listInbox } from './list-inbox.ts';

describe('listInbox', () => {
  it('lists every note waiting in the Inbox, of any type or none', async () => {
    const query = atlasQueryIndex({
      markdown: fakeMarkdown(),
      files: {
        'Inbox/Call the bank.md': '---\ntype: task\n---\n',
        'Inbox/Meetings/Standup.md': '---\ntype: meeting\n---\n',
        'Inbox/Idea.md': 'A thought.\n',
        'Projects/Atlas.md': '---\ntype: project\n---\n',
      },
    });
    const { items, truncated } = await listInbox({ index: fakeIndexPort({ query }) });
    expect(truncated).toBe(false);
    expect(items.map((item) => [item.path, item.type, item.arrivedIn])).toEqual(
      expect.arrayContaining([
        ['Inbox/Call the bank.md', 'task', ''],
        ['Inbox/Meetings/Standup.md', 'meeting', 'Meetings'],
        ['Inbox/Idea.md', null, ''],
      ]),
    );
    expect(items).toHaveLength(3);
  });

  it('leaves out proposals by their type, wherever they are, and lists any other note', async () => {
    const query = atlasQueryIndex({
      markdown: fakeMarkdown(),
      files: {
        'Inbox/Call the bank.md': '---\ntype: task\n---\n',
        'Inbox/Proposals/Send the file.md': '---\ntype: proposal\nkind: task\n---\n',
        'inbox/proposals/Lower case.md': '---\ntype: Proposal\nkind: task\n---\n',
        'Inbox/Moved by hand.md': '---\ntype: proposal\nkind: task\n---\n',
        'Inbox/Proposals/Ideas.md': 'A plain note dropped in with the proposals.\n',
      },
    });
    const { items } = await listInbox({ index: fakeIndexPort({ query }) });
    expect(items.map((item) => item.path).sort()).toEqual([
      'Inbox/Call the bank.md',
      'Inbox/Proposals/Ideas.md',
    ]);
  });

  it('says where each meeting stands with the import, and why one failed', async () => {
    const query = atlasQueryIndex({
      markdown: fakeMarkdown(),
      files: {
        'Inbox/Meetings/Waiting.md': '---\ntype: meeting\n---\n',
        'Inbox/Meetings/Broken.md':
          '---\ntype: meeting\natlas_import_outcome: error\natlas_import_error: title is required\n---\n',
        'Inbox/Meetings/Done.md': '---\ntype: meeting\natlas_import_outcome: imported\n---\n',
        'Inbox/Call.md': '---\ntype: task\n---\n',
      },
    });
    const { items } = await listInbox({ index: fakeIndexPort({ query }) });
    const standing = Object.fromEntries(
      items.map((item) => [item.path, [item.importOutcome, item.importError]]),
    );
    expect(standing).toEqual({
      'Inbox/Meetings/Waiting.md': ['pending', null],
      'Inbox/Meetings/Broken.md': ['error', 'title is required'],
      'Inbox/Meetings/Done.md': ['imported', null],
      'Inbox/Call.md': [null, null],
    });
  });

  it('says when there were more than it lists', async () => {
    const query = atlasQueryIndex({
      markdown: fakeMarkdown(),
      files: { 'Inbox/A.md': 'a\n', 'Inbox/B.md': 'b\n' },
    });
    const listing = await listInbox({ index: fakeIndexPort({ query }), limit: 1 });
    expect(listing.items).toHaveLength(1);
    expect(listing.truncated).toBe(true);
  });
});

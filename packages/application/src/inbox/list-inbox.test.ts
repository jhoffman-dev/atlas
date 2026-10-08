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

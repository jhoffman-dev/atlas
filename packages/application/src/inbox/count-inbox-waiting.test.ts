import { describe, expect, it } from 'vitest';
import { fakeIndexPort } from '../testing/fake-ports.ts';
import { jsonLinesNote, proposalVault } from '../testing/proposal-vault.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';
import { countInboxWaiting } from './count-inbox-waiting.ts';

const openProposal = jsonLinesNote(
  { type: 'proposal', kind: 'task', state: 'open', payload: { title: 'Call Tobias' } },
  'Asked in standup.\n',
);
const answeredProposal = jsonLinesNote(
  { type: 'proposal', kind: 'task', state: 'accepted', payload: { title: 'Done' } },
  '',
);

describe('countInboxWaiting', () => {
  it('counts what waits to be filed and the proposals still open, together', async () => {
    const files = {
      'Inbox/Call the bank.md': jsonLinesNote({ type: 'task' }),
      'Inbox/Idea.md': 'A thought.\n',
      'Inbox/Proposals/Call Tobias.md': openProposal,
      'Inbox/Proposals/Done.md': answeredProposal,
      'Projects/Atlas.md': jsonLinesNote({ type: 'project' }),
    };
    const vault = proposalVault(files);
    const query = atlasQueryIndex({ markdown: vault.ports.markdown, files });
    const waiting = await countInboxWaiting({
      index: fakeIndexPort({ query }),
      fs: vault.ports.fs,
      markdown: vault.ports.markdown,
      tasksStartInInbox: false,
    });
    expect(waiting).toBe(3);
  });

  it('is zero with nothing waiting and no proposals folder', async () => {
    const vault = proposalVault({ 'Projects/Atlas.md': jsonLinesNote({ type: 'project' }) });
    const query = atlasQueryIndex({ markdown: vault.ports.markdown, files: {} });
    const waiting = await countInboxWaiting({
      index: fakeIndexPort({ query }),
      fs: vault.ports.fs,
      markdown: vault.ports.markdown,
      tasksStartInInbox: false,
    });
    expect(waiting).toBe(0);
  });

  it('counts the Inbox the way the page lists it: tasks that start there count once the type says so', async () => {
    const files = { 'Tasks/Loose.md': jsonLinesNote({ type: 'task' }) };
    const vault = proposalVault(files);
    const query = atlasQueryIndex({ markdown: vault.ports.markdown, files });
    const count = (tasksStartInInbox: boolean) =>
      countInboxWaiting({
        index: fakeIndexPort({ query }),
        fs: vault.ports.fs,
        markdown: vault.ports.markdown,
        tasksStartInInbox,
      });
    expect(await count(false)).toBe(0);
    expect(await count(true)).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import { memoryVault } from '../testing/fake-git.ts';
import { fakeVaultFs } from '../testing/fake-ports.ts';
import { captureToInbox } from './capture.ts';

function vault(files: Record<string, string>) {
  const memory = memoryVault(files);
  return { fs: fakeVaultFs(memory.fs), files: memory.files };
}

describe('captureToInbox', () => {
  it('lands the captured note in the Inbox, making the folder when the vault has none', async () => {
    const v = vault({ 'Projects/Atlas.md': 'x\n' });
    const path = await captureToInbox({
      fs: v.fs,
      name: 'Renew the passport',
      notePaths: [createVaultPath('Projects/Atlas.md')],
      contents: '---\ntype: task\n---\n',
    });
    expect(path).toBe('Inbox/Renew the passport.md');
    expect(v.files.get('Inbox/Renew the passport.md')).toBe('---\ntype: task\n---\n');
  });

  it('uses the Inbox as the disk spells it, and numbers a name already waiting there', async () => {
    const v = vault({ 'inbox/Call.md': 'first\n' });
    const path = await captureToInbox({
      fs: v.fs,
      name: 'Call',
      notePaths: [createVaultPath('inbox/Call.md')],
    });
    expect(path).toBe('inbox/Call 2.md');
  });
});

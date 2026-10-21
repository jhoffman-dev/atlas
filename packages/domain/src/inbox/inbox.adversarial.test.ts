/**
 * Adversarial (P30-01, #214): what a note may be filed under. Filing only
 * links a note, so a project at the root named as one of the app's own
 * folders is a project like any other — and a note is still never filed
 * under one of DFAI's own files, or under a project still waiting itself.
 */
import { describe, expect, it } from 'vitest';
import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';
import { filingRefusal, processRefusal } from './inbox.ts';

const path = (raw: string): VaultPath => createVaultPath(raw);

describe('filingRefusal — a project named as the Inbox or the Archive', () => {
  it('files under a project at Inbox.md, which is not in the Inbox', () => {
    expect(filingRefusal({ path: path('Inbox.md'), type: 'project' })).toBeNull();
  });

  it('still refuses a project inside the Inbox folder, in any case', () => {
    expect(filingRefusal({ path: path('INBOX/Plan.md'), type: 'project' })).toContain(
      'still in the Inbox',
    );
  });

  it('still refuses a type file, which is one of DFAI’s own', () => {
    expect(filingRefusal({ path: path('.atlas/types/project.md'), type: 'project' })).toContain(
      'DFAI’s own files',
    );
  });
});

describe('processRefusal — a meeting waits wherever it lives (#214)', () => {
  it('processes a meeting in its month’s folder, and refuses any other note outside the Inbox', () => {
    const meeting = path('Meetings/2026/10/2026-10-01 Standup.md');
    expect(processRefusal({ path: meeting, type: 'meeting' })).toBeNull();
    expect(processRefusal({ path: meeting, type: ' Meeting ' })).toBeNull();
    expect(processRefusal({ path: path('Notes/Plan.md'), type: null })).toBe(
      'It is not in the Inbox.',
    );
  });

  it('still refuses a proposal, whatever folder it is in', () => {
    expect(processRefusal({ path: path('Inbox/Proposals/Ask.md'), type: 'proposal' })).toContain(
      'answered',
    );
  });
});

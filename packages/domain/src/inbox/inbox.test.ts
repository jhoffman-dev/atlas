import { describe, expect, it } from 'vitest';
import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';
import {
  filedUnderStamp,
  filingFolder,
  filingRefusal,
  inboxItem,
  isInInbox,
  isProcessMove,
  processDestination,
  processRefusal,
} from './inbox.ts';

const path = (raw: string): VaultPath => createVaultPath(raw);

describe('isInInbox', () => {
  it('is any note under the Inbox folder at the root, however it is cased', () => {
    expect(isInInbox('Inbox/Call the bank.md')).toBe(true);
    expect(isInInbox('inbox/Meetings/2026-10-01 Standup.md')).toBe(true);
  });

  it('is not a note elsewhere, nor one whose folder merely starts with the word', () => {
    expect(isInInbox('Projects/Inbox/Plan.md')).toBe(false);
    expect(isInInbox('Inboxes/Plan.md')).toBe(false);
    expect(isInInbox('Inbox.md')).toBe(false);
  });
});

describe('processRefusal', () => {
  it('lets a note in the Inbox be processed', () => {
    expect(processRefusal(path('Inbox/Call the bank.md'))).toBeNull();
  });

  it('refuses a note that is not in the Inbox, or is not a note', () => {
    expect(processRefusal(path('Projects/Plan.md'))).toBe('It is not in the Inbox.');
    expect(processRefusal(path('Inbox/scan.pdf'))).toBe('Only notes can be processed.');
  });

  it('refuses a proposal, which is accepted or rejected rather than filed', () => {
    expect(processRefusal(path('Inbox/Proposals/Send the file.md'))).toBe(
      'A proposal is answered, not filed: accept or reject it.',
    );
    expect(processRefusal(path('inbox/PROPOSALS/Send the file.md'))).not.toBeNull();
  });
});

describe('filingRefusal', () => {
  it('files under a project or an area', () => {
    expect(filingRefusal({ path: path('Projects/Atlas.md'), type: 'project' })).toBeNull();
    expect(filingRefusal({ path: path('Areas/Garden.md'), type: 'area' })).toBeNull();
  });

  it('refuses a note of another type', () => {
    expect(filingRefusal({ path: path('People/Mara Quill.md'), type: 'person' })).toBe(
      'Project links to a project or area, not a person',
    );
  });

  it('refuses a note with no type', () => {
    expect(filingRefusal({ path: path('Plan.md'), type: null })).toContain('neither');
  });

  it('refuses a project still in the Inbox, an archived one, or one of Atlas’s own files', () => {
    expect(filingRefusal({ path: path('Inbox/New project.md'), type: 'project' })).toContain(
      'still in the Inbox',
    );
    expect(filingRefusal({ path: path('Archive/Projects/Old.md'), type: 'project' })).toContain(
      'archived',
    );
    expect(filingRefusal({ path: path('.atlas/templates/Project.md'), type: 'project' })).toContain(
      'Atlas’s own files',
    );
  });
});

describe('filing under a project whose folder is somewhere a note cannot stay filed', () => {
  it.each([
    ['Inbox.md', 'the Inbox'],
    ['INBOX.md', 'the Inbox'],
    ['Archive.md', 'the Archive'],
    ['archive.md', 'the Archive'],
  ])('refuses %s, whose folder is %s', (at, place) => {
    expect(filingRefusal({ path: path(at), type: 'project' })).toContain(`Its folder is ${place}`);
  });

  it('refuses one whose folder Atlas hides', () => {
    expect(filingRefusal({ path: path('node_modules.md'), type: 'area' })).toBe(
      'Its folder is one Atlas does not show.',
    );
  });

  it('files under a project merely named like those folders, elsewhere', () => {
    expect(filingRefusal({ path: path('Projects/Inbox.md'), type: 'project' })).toBeNull();
    expect(filingRefusal({ path: path('Areas/Archive.md'), type: 'area' })).toBeNull();
  });
});

describe('filing under a project kept deep in the vault', () => {
  it('refuses one whose folder would be deeper than the vault is read', () => {
    const folders = (count: number) => Array.from({ length: count }, (_, at) => `f${at}`).join('/');
    expect(filingRefusal({ path: path(`${folders(32)}/Deep.md`), type: 'project' })).toContain(
      'too many folders deep',
    );
    expect(filingRefusal({ path: path(`${folders(31)}/Deep.md`), type: 'project' })).toBeNull();
  });
});

describe('filingFolder', () => {
  it('is a folder named as the project, beside its note', () => {
    expect(filingFolder(path('Projects/Atlas.md'))).toBe('Projects/Atlas');
    expect(filingFolder(path('Garden.md'))).toBe('Garden');
  });

  it('is the project’s own folder in any case, as the disk compares names', () => {
    expect(filingFolder(path('Areas/HOME/home.md'))).toBe('Areas/HOME');
  });

  it('is the project’s own folder when the project is that folder’s note', () => {
    expect(filingFolder(path('Projects/Atlas/Atlas.md'))).toBe('Projects/Atlas');
    expect(filingFolder(path('Areas/home/Home.md'))).toBe('Areas/home');
  });
});

describe('processDestination', () => {
  it('files the note under the project by its own name, leaving the Inbox folders behind', () => {
    expect(
      processDestination({
        path: path('Inbox/Meetings/2026-10-01 Standup.md'),
        project: path('Projects/Atlas.md'),
        taken: new Set(),
      }),
    ).toBe('Projects/Atlas/2026-10-01 Standup.md');
  });

  it('numbers it when the project already has a note of that name', () => {
    expect(
      processDestination({
        path: path('Inbox/Notes.md'),
        project: path('Projects/Atlas.md'),
        taken: new Set(['projects/atlas/notes.md']),
      }),
    ).toBe('Projects/Atlas/Notes 2.md');
  });
});

describe('filedUnderStamp', () => {
  it('links the project by its name', () => {
    const notePaths = [path('Projects/Atlas.md'), path('Inbox/Call.md')];
    expect(filedUnderStamp({ project: path('Projects/Atlas.md'), notePaths })).toEqual({
      project: '[[Atlas]]',
    });
  });

  it('links it by its path where the name alone would open another note', () => {
    const notePaths = [path('Areas/Garden.md'), path('Projects/Garden.md')];
    expect(filedUnderStamp({ project: path('Projects/Garden.md'), notePaths })).toEqual({
      project: '[[Projects/Garden]]',
    });
  });
});

describe('inboxItem', () => {
  it('says which folder of the Inbox a note arrived in, and its type', () => {
    expect(
      inboxItem({ path: path('Inbox/Meetings/Standup.md'), title: 'Standup', type: 'meeting' }),
    ).toEqual({
      path: 'Inbox/Meetings/Standup.md',
      title: 'Standup',
      type: 'meeting',
      arrivedIn: 'Meetings',
      importOutcome: 'pending',
      importError: null,
    });
  });

  it('reads a plain note at the top of the Inbox as having no type and no folder', () => {
    expect(inboxItem({ path: path('Inbox/Call.md'), title: 'Call', type: null })).toMatchObject({
      type: null,
      arrivedIn: '',
    });
    expect(inboxItem({ path: path('Inbox/Call.md'), title: 'Call', type: '  ' }).type).toBeNull();
  });
});

describe('isProcessMove', () => {
  it('is a note filed out of the Inbox under its own name, numbered or not', () => {
    const from = path('Inbox/Meetings/Kickoff.md');
    expect(isProcessMove(from, path('Projects/Atlas/Kickoff.md'))).toBe(true);
    expect(isProcessMove(from, path('projects/atlas/kickoff.md'))).toBe(true);
    expect(isProcessMove(from, path('Projects/Atlas/Kickoff 2.md'))).toBe(true);
  });

  it('is not a move within the Inbox, into the Archive, or to another name', () => {
    const from = path('Inbox/Kickoff.md');
    expect(isProcessMove(from, path('Inbox/Meetings/Kickoff.md'))).toBe(false);
    expect(isProcessMove(from, path('Archive/Inbox/Kickoff.md'))).toBe(false);
    expect(isProcessMove(from, path('Projects/Atlas/Launch.md'))).toBe(false);
    expect(isProcessMove(path('Notes/Kickoff.md'), path('Projects/Atlas/Kickoff.md'))).toBe(false);
  });
});

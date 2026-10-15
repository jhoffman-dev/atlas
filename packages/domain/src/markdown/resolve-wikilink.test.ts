import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  createWikiLinkResolver,
  linkTakeover,
  resolveWikiLinkTarget,
  wikiLinkNewNotePath,
  wikiLinkTargetFor,
} from './resolve-wikilink.ts';

const notes = (...paths: string[]) => paths.map(createVaultPath);

describe('resolveWikiLinkTarget', () => {
  it('matches a note by name anywhere in the vault', () => {
    expect(resolveWikiLinkTarget('Another Note', notes('Notes/Another Note.md', 'other.md'))).toBe(
      'Notes/Another Note.md',
    );
  });

  it('matches when the link includes the extension', () => {
    expect(resolveWikiLinkTarget('Another Note.md', notes('Notes/Another Note.md'))).toBe(
      'Notes/Another Note.md',
    );
  });

  it('treats a target containing a slash as a path', () => {
    const vault = notes('Notes/Today.md', 'Archive/Today.md');
    expect(resolveWikiLinkTarget('Archive/Today', vault)).toBe('Archive/Today.md');
  });

  it('does not match a path against a bare filename', () => {
    expect(resolveWikiLinkTarget('Archive/Today', notes('Notes/Today.md'))).toBeNull();
  });

  it('prefers the shallowest note when a name repeats', () => {
    const vault = notes('deep/deeper/Today.md', 'Today.md', 'deep/Today.md');
    expect(resolveWikiLinkTarget('Today', vault)).toBe('Today.md');
  });

  it('breaks a tie between equal depths alphabetically, so it is stable', () => {
    const vault = notes('b/Today.md', 'a/Today.md');
    expect(resolveWikiLinkTarget('Today', vault)).toBe('a/Today.md');
    expect(resolveWikiLinkTarget('Today', [...vault].reverse())).toBe('a/Today.md');
  });

  it('prefers an exact case match over a differing one', () => {
    const vault = notes('today.md', 'Today.md');
    expect(resolveWikiLinkTarget('Today', vault)).toBe('Today.md');
  });

  it('falls back to a case-insensitive match', () => {
    expect(resolveWikiLinkTarget('today', notes('Notes/Today.md'))).toBe('Notes/Today.md');
  });

  it('returns null when nothing matches', () => {
    expect(resolveWikiLinkTarget('Missing', notes('Today.md'))).toBeNull();
  });

  it.each(['', '   '])('returns null for a blank target (%j)', (target) => {
    expect(resolveWikiLinkTarget(target, notes('Today.md'))).toBeNull();
  });

  it('ignores surrounding whitespace in the link', () => {
    expect(resolveWikiLinkTarget('  Today  ', notes('Today.md'))).toBe('Today.md');
  });

  it('returns null for an empty vault', () => {
    expect(resolveWikiLinkTarget('Today', [])).toBeNull();
  });
});

describe('wikiLinkNewNotePath', () => {
  it('adds a markdown extension', () => {
    expect(wikiLinkNewNotePath('New Note')).toBe('New Note.md');
  });

  it('keeps an extension that is already there', () => {
    expect(wikiLinkNewNotePath('New Note.md')).toBe('New Note.md');
  });

  it('keeps a folder in the target', () => {
    expect(wikiLinkNewNotePath('Notes/New')).toBe('Notes/New.md');
  });

  it('returns null for a blank target', () => {
    expect(wikiLinkNewNotePath('  ')).toBeNull();
  });
});

describe('wikiLinkTargetFor', () => {
  const atlas = createVaultPath('projects/Atlas.md');

  it('writes the bare name when it opens the note', () => {
    expect(wikiLinkTargetFor(atlas, notes('projects/Atlas.md', 'b.md'))).toBe('Atlas');
  });

  it('writes the path when a shallower note of the same name would open instead', () => {
    const target = wikiLinkTargetFor(atlas, notes('Atlas.md', 'projects/Atlas.md'));
    expect(target).toBe('projects/Atlas');
    expect(resolveWikiLinkTarget(target, notes('Atlas.md', 'projects/Atlas.md'))).toBe(atlas);
  });

  it('writes the path when the note is not among those known', () => {
    expect(wikiLinkTargetFor(atlas, [])).toBe('projects/Atlas');
  });
});

describe('names spelled with accents composed differently (A21-02)', () => {
  // macOS keyboards type NFC; files synced from other tools are often NFD.
  it('opens the note whichever way the link and the file compose them', () => {
    expect(resolveWikiLinkTarget('Zo\u00eb', notes('People/Zoe\u0308.md'))).toBe(
      'People/Zoe\u0308.md',
    );
    expect(resolveWikiLinkTarget('People/Zoe\u0308', notes('People/Zo\u00eb.md'))).toBe(
      'People/Zo\u00eb.md',
    );
    expect(resolveWikiLinkTarget('zo\u00cb', notes('People/Zoe\u0308.md'))).toBe(
      'People/Zoe\u0308.md',
    );
  });
});

describe('linkTakeover', () => {
  it('is nothing when no note has the name yet', () => {
    expect(linkTakeover(createVaultPath('People/Sam.md'), notes('Plan.md'))).toBeNull();
  });

  it('is nothing when the note already there still wins', () => {
    for (const there of ['Sam.md', 'Clients/Sam.md', 'Notes/Sam.md']) {
      expect(linkTakeover(createVaultPath('People/Sam.md'), notes(there))).toBeNull();
    }
  });

  it('is the note whose links a new one of the same name would open instead', () => {
    // Shallower, or first alphabetically at the same depth, wins.
    expect(linkTakeover(createVaultPath('People/Sam.md'), notes('Zeta/Sam.md'))).toBe(
      'Zeta/Sam.md',
    );
    expect(linkTakeover(createVaultPath('People/Sam.md'), notes('a/b/Sam.md'))).toBe('a/b/Sam.md');
  });

  it('counts a link written in another case, which opens the note only by folding it', () => {
    // [[Sam]] opens Clients/sam.md today; beside People/Sam.md it would match exactly.
    expect(linkTakeover(createVaultPath('People/Sam.md'), notes('Clients/sam.md'))).toBe(
      'Clients/sam.md',
    );
  });

  it('counts a name composed differently as the same name', () => {
    expect(linkTakeover(createVaultPath('People/Zo\u00eb.md'), notes('Zeta/Zoe\u0308.md'))).toBe(
      'Zeta/Zoe\u0308.md',
    );
  });
});

describe('createWikiLinkResolver', () => {
  const vault = notes(
    'Sam.md',
    'Clients/Sam.md',
    'Clients/sam.md',
    'People/Zoe\u0308.md',
    'a/b/Deep.md',
    'Z/Deep.md',
    'Plan.markdown',
    'Notes/plan.md',
  );
  const targets = [
    'Sam',
    'sam',
    'SAM',
    'Clients/Sam',
    'clients/sam',
    'Clients/Sam.md',
    'Zo\u00eb',
    'ZOE\u0308',
    'Deep',
    'deep',
    'Plan',
    'plan',
    'Plan.md',
    'Nothing',
    '',
    '  Sam  ',
  ];

  it('opens what resolveWikiLinkTarget opens, for every kind of target', () => {
    const resolve = createWikiLinkResolver(vault);
    for (const target of targets) {
      expect(resolve(target), target).toBe(resolveWikiLinkTarget(target, vault));
    }
  });
});

describe('a link never opens a template (issue #15)', () => {
  // James's vault after the bug: the Company template renamed to the company's name.
  const vault = notes('.atlas/templates/Larkspur Payroll.md', 'Sam Rivera.md');

  it('does not resolve a name to a template', () => {
    expect(resolveWikiLinkTarget('Larkspur Payroll', vault)).toBeNull();
    expect(createWikiLinkResolver(vault)('Larkspur Payroll')).toBeNull();
  });

  it('does not resolve a path to one either', () => {
    expect(resolveWikiLinkTarget('.atlas/templates/Larkspur Payroll', vault)).toBeNull();
  });

  it('still opens the other notes in .atlas, which are linkable on purpose (hidden-notes e2e)', () => {
    const types = notes('.atlas/types/company.md');
    expect(resolveWikiLinkTarget('company', types)).toBe('.atlas/types/company.md');
    expect(createWikiLinkResolver(types)('.atlas/types/company')).toBe('.atlas/types/company.md');
  });

  it('opens the vault’s own note of that name, however deep, rather than the template', () => {
    const both = notes('.atlas/templates/Company.md', 'Clients/Deep/Company.md');
    expect(resolveWikiLinkTarget('Company', both)).toBe('Clients/Deep/Company.md');
    expect(createWikiLinkResolver(both)('company')).toBe('Clients/Deep/Company.md');
  });
});

describe('a name shared with a proposal or an archived note (#214)', () => {
  it('opens the task, not the archived proposal of the same name at the same depth', () => {
    const vault = notes(
      'Archive/Inbox/Proposals/Send Mara the payroll file.md',
      'Tasks/2026/10/Send Mara the payroll file.md',
    );
    expect(resolveWikiLinkTarget('Send Mara the payroll file', vault)).toBe(
      'Tasks/2026/10/Send Mara the payroll file.md',
    );
  });

  it('opens the meeting, not an archived copy of it, however shallow the copy is', () => {
    const vault = notes(
      'Archive/Standup.md',
      'Meetings/2026/10/Standup.md',
      'Archive/Inbox/Meetings/Standup.md',
    );
    expect(resolveWikiLinkTarget('Standup', vault)).toBe('Meetings/2026/10/Standup.md');
  });

  it('opens a note in use before a proposal still waiting, though the proposal is shallower', () => {
    const vault = notes(
      'Inbox/Proposals/Send Mara the payroll file.md',
      'Tasks/2026/10/Send Mara the payroll file.md',
    );
    expect(resolveWikiLinkTarget('Send Mara the payroll file', vault)).toBe(
      'Tasks/2026/10/Send Mara the payroll file.md',
    );
  });

  it('opens a proposal still waiting before an archived note', () => {
    const vault = notes('Archive/Plan.md', 'Inbox/Proposals/Plan.md');
    expect(resolveWikiLinkTarget('Plan', vault)).toBe('Inbox/Proposals/Plan.md');
  });

  it('still opens an archived note when it is the only one of that name', () => {
    expect(resolveWikiLinkTarget('Old', notes('Archive/Notes/Old.md'))).toBe(
      'Archive/Notes/Old.md',
    );
  });

  it('ranks the same way in the resolver built once for a whole note', () => {
    const resolve = createWikiLinkResolver(
      notes('Archive/Inbox/Proposals/Brief.md', 'Inbox/Proposals/Brief.md', 'Briefs/2026/Brief.md'),
    );
    expect(resolve('Brief')).toBe('Briefs/2026/Brief.md');
  });

  it('writes a bare name for a task whose namesakes are a proposal and its archived copy', () => {
    const vault = notes(
      'Inbox/Proposals/Send Mara the payroll file.md',
      'Archive/Inbox/Proposals/Send Mara the payroll file.md',
      'Tasks/2026/10/Send Mara the payroll file.md',
    );
    expect(
      wikiLinkTargetFor(createVaultPath('Tasks/2026/10/Send Mara the payroll file.md'), vault),
    ).toBe('Send Mara the payroll file');
  });
});

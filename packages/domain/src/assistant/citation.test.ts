import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { linkingAmong, noteCitation, sourceCitation, turnCitation } from './citation.ts';

const NOTES = [
  'Meetings/Kickoff.md',
  'People/Mara Quill.md',
  'Projects/Alpha/Plan.md',
  'Projects/Beta/Plan.md',
].map(createVaultPath);

const { targetOf, resolve } = linkingAmong(NOTES);
const KICKOFF = createVaultPath('Meetings/Kickoff.md');

describe('citations', () => {
  it('cites a note by its name, or by its path when another note shares the name', () => {
    expect(noteCitation(KICKOFF, targetOf)).toEqual({
      link: '[[Kickoff]]',
      kind: 'note',
      path: 'Meetings/Kickoff.md',
    });
    expect(noteCitation(createVaultPath('Projects/Beta/Plan.md'), targetOf).link).toBe(
      '[[Projects/Beta/Plan]]',
    );
  });

  it('cites a turn by its block, and one with no id by the Transcript heading over it', () => {
    expect(turnCitation(KICKOFF, 't0003', targetOf)).toEqual({
      link: '[[Kickoff#^t0003]]',
      kind: 'block',
      path: 'Meetings/Kickoff.md',
    });
    expect(turnCitation(KICKOFF, null, targetOf)).toEqual({
      link: '[[Kickoff#Transcript]]',
      kind: 'heading',
      path: 'Meetings/Kickoff.md',
    });
  });

  it('reads a source written as a block link, resolving the note it names', () => {
    expect(sourceCitation('[[Kickoff#^t0003]]', resolve)).toEqual({
      link: '[[Kickoff#^t0003]]',
      kind: 'block',
      path: 'Meetings/Kickoff.md',
    });
  });

  it('writes a source back without its alias, and says what it names', () => {
    expect(sourceCitation(' [[Kickoff#Notes|the notes]] ', resolve)).toEqual({
      link: '[[Kickoff#Notes]]',
      kind: 'heading',
      path: 'Meetings/Kickoff.md',
    });
    expect(sourceCitation('[[Mara Quill|Mara]]', resolve)).toEqual({
      link: '[[Mara Quill]]',
      kind: 'note',
      path: 'People/Mara Quill.md',
    });
  });

  it('writes a link with an empty fragment back as the note', () => {
    expect(sourceCitation('[[Kickoff#]]', resolve)).toEqual({
      link: '[[Kickoff]]',
      kind: 'note',
      path: 'Meetings/Kickoff.md',
    });
  });

  it('cites a source that names no note as that note, with no path: a block of nothing is not vouched for', () => {
    expect(sourceCitation('[[Gone#^t0001]]', resolve)).toEqual({
      link: '[[Gone]]',
      kind: 'note',
      path: null,
    });
    // A heading is kept as written: the index holds no headings to check it by.
    expect(sourceCitation('[[Gone#Plans]]', resolve)).toEqual({
      link: '[[Gone#Plans]]',
      kind: 'heading',
      path: null,
    });
  });

  it('cites nothing for a source that is not exactly one link', () => {
    for (const source of [
      undefined,
      null,
      3,
      '',
      'from the kickoff',
      '![[Kickoff]]',
      '[[A]] [[B]]',
    ]) {
      expect(sourceCitation(source, resolve)).toBeNull();
    }
  });
});

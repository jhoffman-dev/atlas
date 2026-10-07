import { describe, expect, it } from 'vitest';
import type { VaultPath } from '../vault/vault-path.ts';
import { notesAfterMove, retargetLinks } from './retarget-links.ts';

/*
 * A relative image source is read from the note's folder, so a move of the note
 * or of the folder holding the image can leave it pointing at nothing. "Update
 * links" re-points it, counts it, and changes nothing else.
 */

/** `text`, in the note now at `path`, after `from` moved to `to` in a vault holding `files`. */
function afterMove({
  text,
  path,
  from,
  to,
  notes,
  files,
}: {
  text: string;
  path: string;
  from: string;
  to: string;
  notes: string[];
  files: string[];
}) {
  const move = { from: from as VaultPath, to: to as VaultPath };
  return retargetLinks({
    text,
    path: path as VaultPath,
    exists: (file) => files.includes(file),
    ...notesAfterMove(move, notes as VaultPath[]),
  });
}

describe('retargetLinks, for image sources', () => {
  it('re-points an image in a note that did not move, into a folder that did', () => {
    expect(
      afterMove({
        text: 'Look: ![](Work/pic.png)\n',
        path: 'Home.md',
        from: 'Work',
        to: 'Archive/Work',
        notes: ['Home.md', 'Work/a.md'],
        files: ['Archive/Work/pic.png'],
      }),
    ).toEqual({ text: 'Look: ![](Archive/Work/pic.png)\n', count: 1 });
  });

  it('leaves an image that moved along with its note, in the same folder', () => {
    const text = '![](pic.png)\n';
    expect(
      afterMove({
        text,
        path: 'Archive/Work/a.md',
        from: 'Work',
        to: 'Archive/Work',
        notes: ['Work/a.md'],
        files: ['Archive/Work/pic.png'],
      }),
    ).toEqual({ text, count: 0 });
  });

  it('leaves a note the move did not touch, even one found from the vault root', () => {
    const text = '![](attachments/pic.png)\n';
    expect(
      afterMove({
        text,
        path: 'Notes/b.md',
        from: 'Plan.md',
        to: 'Roadmap.md',
        notes: ['Notes/b.md', 'Plan.md'],
        files: ['attachments/pic.png'],
      }),
    ).toEqual({ text, count: 0 });
  });

  it('changes only the destination, keeping the alt text, the title and the rest', () => {
    expect(
      afterMove({
        text: 'A ![Chart *one*](../attachments/c.png "Q3") and [[Other]].\n',
        path: 'Work/Plans/q3.md',
        from: 'Work/q3.md',
        to: 'Work/Plans/q3.md',
        notes: ['Work/q3.md'],
        files: ['attachments/c.png'],
      }),
    ).toEqual({
      text: 'A ![Chart *one*](../../attachments/c.png "Q3") and [[Other]].\n',
      count: 1,
    });
  });

  it('writes a destination in angle brackets back percent-encoded', () => {
    expect(
      afterMove({
        text: '![](<../attachments/my pic.png>)\n',
        path: 'q3.md',
        from: 'Work/q3.md',
        to: 'q3.md',
        notes: ['Work/q3.md'],
        files: ['attachments/my pic.png'],
      }).text,
    ).toBe('![](attachments/my%20pic.png)\n');
  });

  it('leaves an image in code, one outside the vault, and one that is not there', () => {
    const text = [
      '`![](../a.png)`',
      '![](https://example.com/a.png)',
      '![](../missing.png)',
      '',
    ].join('\n');
    expect(
      afterMove({
        text,
        path: 'q3.md',
        from: 'Work/q3.md',
        to: 'q3.md',
        notes: ['Work/q3.md'],
        files: ['a.png'],
      }),
    ).toEqual({ text, count: 0 });
  });

  it('counts image sources and wiki links together', () => {
    expect(
      afterMove({
        text: '[[Work/q3]] ![](../pic.png)\n',
        path: 'q3.md',
        from: 'Work/q3.md',
        to: 'q3.md',
        notes: ['Work/q3.md'],
        files: ['pic.png'],
      }),
    ).toEqual({ text: '[[q3]] ![](pic.png)\n', count: 2 });
  });
});

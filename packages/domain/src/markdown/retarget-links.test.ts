import { describe, expect, it } from 'vitest';
import type { VaultPath } from '../vault/vault-path.ts';
import { notesAfterMove, retargetLinks } from './retarget-links.ts';

const paths = (...list: string[]) => list as VaultPath[];
const NOTES = paths('Plan.md', 'Notes/Ideas.md', 'Archive/Old.md', 'Journal/Today.md');

/** What `text` becomes after `from` goes to `to`, with how many links changed. */
function retarget(text: string, from: string, to: string, notes: readonly VaultPath[] = NOTES) {
  const move = { from: from as VaultPath, to: to as VaultPath };
  // The note holding the text is one no move here carries, with no images to follow.
  const path = 'Elsewhere/Holder.md' as VaultPath;
  return retargetLinks({ text, path, exists: () => false, ...notesAfterMove(move, notes) });
}

describe('retargetLinks', () => {
  it('points a link at the new name of the note it opened', () => {
    expect(retarget('See [[Plan]] today.', 'Plan.md', 'Roadmap.md')).toEqual({
      text: 'See [[Roadmap]] today.',
      count: 1,
    });
  });

  it('keeps a heading, an alias and an embed, and changes only the name', () => {
    const text = 'A [[Plan#Goals|the goals]], ![[Plan]] and [[plan]].';
    expect(retarget(text, 'Plan.md', 'Roadmap.md')).toEqual({
      text: 'A [[Roadmap#Goals|the goals]], ![[Roadmap]] and [[Roadmap]].',
      count: 3,
    });
  });

  it('keeps a block id and a heading of a shown block, and changes only the name (P26-03)', () => {
    const text = '![[Plan#^f3k9x2]]\n\n![[Plan#Goals]]\n\nSee [[Plan#^f3k9x2|that]].';
    expect(retarget(text, 'Plan.md', 'Roadmap.md')).toEqual({
      text: '![[Roadmap#^f3k9x2]]\n\n![[Roadmap#Goals]]\n\nSee [[Roadmap#^f3k9x2|that]].',
      count: 3,
    });
  });

  it('rewrites a link in the frontmatter, as a relation holds one', () => {
    const text = '---\nproject: "[[Plan]]"\n---\n\nBody.\n';
    expect(retarget(text, 'Plan.md', 'Roadmap.md').text).toBe(
      '---\nproject: "[[Roadmap]]"\n---\n\nBody.\n',
    );
  });

  it('leaves links to other notes, and code, exactly as they were', () => {
    const text = [
      '[[Ideas]] and `[[Plan]]`',
      '',
      '```',
      '[[Plan]]',
      '```',
      '',
      '~~~md',
      '[[Plan]]',
      '~~~',
      '',
    ].join('\n');
    expect(retarget(text, 'Plan.md', 'Roadmap.md')).toEqual({ text, count: 0 });
  });

  it('changes nothing when a move keeps the name the link finds it by', () => {
    const text = 'See [[Ideas]].';
    expect(retarget(text, 'Notes/Ideas.md', 'Archive/Ideas.md')).toEqual({ text, count: 0 });
  });

  it('follows a link written as a path to where the note went', () => {
    expect(retarget('See [[Notes/Ideas]].', 'Notes', 'Archive/Notes').text).toBe(
      'See [[Archive/Notes/Ideas]].',
    );
  });

  it('writes the path when the name alone would now open another note', () => {
    // Of two notes called Today, the link opened A's; moved past B, it would open B's.
    const notes = paths('A/Today.md', 'B/Today.md');
    expect(retarget('See [[Today]].', 'A/Today.md', 'C/Today.md', notes)).toEqual({
      text: 'See [[C/Today]].',
      count: 1,
    });
  });

  it('leaves a link that opened a different note of the same name', () => {
    const notes = paths('Plan.md', 'Work/Plan.md');
    const text = 'Work: [[Work/Plan]], home: [[Plan]]';
    expect(retarget(text, 'Work/Plan.md', 'Work/Roadmap.md', notes)).toEqual({
      text: 'Work: [[Work/Roadmap]], home: [[Plan]]',
      count: 1,
    });
  });
});

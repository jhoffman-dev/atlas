import { describe, expect, it } from 'vitest';
import { resolveImageSource } from '../markdown/image-source.ts';
import { notesAfterMove, retargetLinks } from '../markdown/retarget-links.ts';
import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';
import { relativeImageSource } from './image-placement.ts';

/*
 * An image pasted into a note is written as a path relative to the note
 * (`../../attachments/x.png`). Moving the note must not leave that path
 * pointing at nothing: either the move's link update rewrites it, or the
 * image is still found from the note's new folder.
 */

const IMAGE = createVaultPath('attachments/Pasted image 20260925143012.png');

/** The image line in `from`, carried through a move to `to` and its "Update links". */
function imageAfterMove({ from, to }: { from: string; to: string }) {
  const notePath = createVaultPath(from);
  const text = `Intro.\n\n![](${relativeImageSource({ notePath, imagePath: IMAGE })})\n`;
  const move = { from: notePath, to: createVaultPath(to) };
  const { text: updated } = retargetLinks({
    text,
    path: move.to,
    exists: (path) => path === IMAGE,
    ...notesAfterMove(move, [notePath] as VaultPath[]),
  });
  const src = /!\[[^\]]*\]\(([^)]*)\)/.exec(updated)?.[1] ?? '';
  return resolveImageSource({ src, notePath: move.to });
}

describe('an embedded image, once its note is moved', () => {
  it('is still found when the note moves up to the vault root', () => {
    expect(imageAfterMove({ from: 'Work/Plans/q3.md', to: 'q3.md' })).toEqual({
      kind: 'vault',
      path: IMAGE,
    });
  });

  it('is still found when the note moves one folder shallower', () => {
    expect(imageAfterMove({ from: 'Work/Plans/q3.md', to: 'Work/q3.md' })).toEqual({
      kind: 'vault',
      path: IMAGE,
    });
  });

  it('is still found when the note moves deeper', () => {
    expect(imageAfterMove({ from: 'q3.md', to: 'Work/Plans/q3.md' })).toEqual({
      kind: 'vault',
      path: IMAGE,
    });
  });
});

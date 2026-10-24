import { describe, expect, it } from 'vitest';
import { HighlightCommentChangedError } from '@dfai/domain';
import { HighlightDrafts, type WriteComment } from './highlight-drafts.ts';

/*
 * Regression (#534, found on f4c54b6b). Kept comments are offered to every
 * pane that opens the note, each seeding its own drafts over the same base.
 * Two panes on the note closing together (a vault switch, closing both tabs):
 * the first writes the words, the second's write over the old base is refused
 * though the note now holds exactly its words — it is reported "not saved"
 * and kept again.
 */

/** One note's comments, written only over the comment they started from, as `editHighlightComment` does. */
function noteOnDisk(initial: Record<string, string>) {
  const disk = new Map(Object.entries(initial));
  const write: WriteComment = async ({ id, comment, base }) => {
    await Promise.resolve();
    const current = disk.get(id) ?? '';
    if (current !== base) throw new HighlightCommentChangedError(id, current);
    disk.set(id, comment);
  };
  return { disk, write };
}

describe('a kept comment put back in two panes of one note', () => {
  it('is not reported unwritten by the second pane once the first has written it', async () => {
    const { disk, write } = noteOnDisk({ h1: 'Lit by Mara.' });
    const kept = [{ id: 'h1', comment: 'Kept from last time.', base: 'Lit by Mara.' }];
    const first = new HighlightDrafts();
    const second = new HighlightDrafts();
    first.restore(kept);
    second.restore(kept);
    const [lostFirst, lostSecond] = await Promise.all([first.flush(write), second.flush(write)]);
    expect(disk.get('h1')).toBe('Kept from last time.');
    expect([...lostFirst, ...lostSecond]).toEqual([]);
  });
});

/*
 * `lastHeld` (note-editor.tsx): a note read as no literature note any more
 * flushes its drafts and keeps the editor. Read as one again while that
 * flush's write is still on disk, its fields are drawn and typed in — over
 * the same `HighlightDrafts`, which the flush then clears whole, words it
 * never wrote nor reported included.
 */
describe('a comment typed while the drafts are being flushed', () => {
  it('is not cleared by the flush it was typed after', async () => {
    const drafts = new HighlightDrafts();
    const settles: (() => void)[] = [];
    const write: WriteComment = () =>
      new Promise<void>((resolve) => {
        settles.push(resolve);
      });
    drafts.of('h1', 'Lit by Mara.');
    drafts.type('h1', 'Written as the note stopped being literature.');
    const flushed = drafts.flush(write);
    // The note is literature again; the person types in another highlight's field.
    drafts.of('h2', 'Quiet tide.');
    drafts.type('h2', 'Typed while the flush was on disk.');
    settles[0]?.();
    const lost = await flushed;
    const kept = drafts.unwritten().includes('h2') || lost.some((each) => each.id === 'h2');
    expect(kept).toBe(true);
  });
});

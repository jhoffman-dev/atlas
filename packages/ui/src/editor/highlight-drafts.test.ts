import { describe, expect, it, vi } from 'vitest';
import { HighlightDrafts, type WriteComment } from './highlight-drafts.ts';

/** A write that settles only when told to, as a slow disk or a sync's write does. */
function heldWrite() {
  const settles: (() => void)[] = [];
  const write = vi.fn<WriteComment>(
    () =>
      new Promise<void>((resolve) => {
        settles.push(resolve);
      }),
  );
  return { write, settle: (at: number) => settles[at]?.() };
}

/*
 * Verification pass 2 on ba80bef2 (#534): every pane's work is written — a
 * sync, a vault switch, the window closing — while the person keeps typing in
 * a comment field. Words typed during that write are theirs too: the draft
 * stays unwritten, over the comment just written, so the next write goes
 * through the usual check against that comment and is not lost.
 */
describe('a comment typed while a write the person did not start is under way', () => {
  it('stays unwritten over the comment that write put down', async () => {
    const drafts = new HighlightDrafts();
    const { write, settle } = heldWrite();
    drafts.of('h1', 'Lit by Mara.');
    drafts.type('h1', 'Half');
    const written = drafts.writeUnwritten(write);
    drafts.type('h1', 'Half a thought');
    settle(0);
    await written;
    expect(drafts.of('h1', 'Half')).toMatchObject({ text: 'Half a thought', base: 'Half' });
    expect(drafts.unwritten()).toEqual(['h1']);
  });

  it('is written, over the comment that write put down, when the note closes after it', async () => {
    const drafts = new HighlightDrafts();
    const { write, settle } = heldWrite();
    drafts.of('h1', 'Lit by Mara.');
    drafts.type('h1', 'Half');
    void drafts.writeUnwritten(write);
    drafts.type('h1', 'Half a thought');
    const closing = drafts.flush(write);
    settle(0);
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    settle(1);
    expect(await closing).toEqual([]);
    expect(write.mock.calls[1]?.[0]).toEqual({
      id: 'h1',
      comment: 'Half a thought',
      base: 'Half',
    });
  });
});

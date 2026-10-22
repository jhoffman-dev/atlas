// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createVaultPath, type HighlightOpening, type VaultPath } from '@dfai/domain';
import { createRevealStore, requestReveal, useTabReveal } from '../panes/reveals.ts';
import { createOverlayStore } from '../overlay-store.ts';
import { useHeldReveal } from '../reader/held-reveal.ts';
import { clickLink, followLink, openNote, type LinkPlaces } from './open-place.ts';
import {
  closePane,
  createWorkspaceStore,
  loadVault,
  splitPane,
  workspaceNow,
} from './workspace-store.ts';

/*
 * Regression (#506): a block link now reads its note before it opens
 * anything, and `[[…pdf]]` is read before notes are. Where those reads
 * resolve late, or out of order, the click that lands must be the one the
 * person made last, in the place they are still looking at.
 */

const SOURCE = createVaultPath('Library/The Lantern Keepers.md');
const OTHER = createVaultPath('Library/Brightwater Notes.md');
const PLAN = createVaultPath('Plan.md');
const ELSEWHERE = createVaultPath('Elsewhere.md');
const PDF = createVaultPath('Library/the-lantern-keepers.pdf');
const NOTE_NAMED_PDF = createVaultPath('Meetings/Budget review.pdf.md');

/** A read whose answer the test hands over when it chooses. */
function deferred<Value>() {
  let resolve: (value: Value) => void = () => {};
  const promise = new Promise<Value>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** `places` null: the link rules before #506, every link a note. */
function wiring(
  places: LinkPlaces | null,
  notePaths: VaultPath[] = [SOURCE, OTHER, PLAN, ELSEWHERE],
) {
  const store = createWorkspaceStore({ remembered: { read: () => null, write: () => {} } });
  loadVault(store, '/v');
  openNote(store, PLAN);
  return {
    store,
    reveals: createRevealStore(),
    overlays: createOverlayStore(),
    notePaths,
    onProblem: vi.fn(),
    ...(places !== null && { places }),
  };
}

const placesOf = (store: ReturnType<typeof wiring>['store'], pane = 0) =>
  workspaceNow(store).panes[pane]?.tabs.map((tab) => tab.history.current) ?? [];

const flush = () => new Promise((done) => setTimeout(done, 0));

describe('two block links clicked in quick succession in one tab', () => {
  it('ends on the one clicked last, though its note was read first', async () => {
    const slow = deferred<HighlightOpening>();
    const places: LinkPlaces = {
      blockOpening: ({ note, blockId }) =>
        note === SOURCE
          ? slow.promise
          : Promise.resolve({ kind: 'note', note, blockId } satisfies HighlightOpening),
      linkedPdf: async () => null,
    };
    const w = wiring(places);
    const link = (target: string, id: string) =>
      clickLink(w, { pane: 0, target, heading: `#^${id}`, how: 'here', inPeek: false });

    link('The Lantern Keepers', 'k3x9q2'); // read is slow
    link('Brightwater Notes', 'b7c8d9'); // read is quick
    await flush();
    expect(placesOf(w.store)).toEqual([{ kind: 'note', path: OTHER }]);

    slow.resolve({ kind: 'reader', source: 'pdf', document: PDF, highlightId: 'k3x9q2' });
    await flush();
    // The earlier click's late answer must not pull the tab back to the first highlight.
    expect(placesOf(w.store)).toEqual([{ kind: 'note', path: OTHER }]);
  });
});

describe('a block link whose note is read after the person has moved on', () => {
  it('does not take over the pane they have since opened something else in', async () => {
    const slow = deferred<HighlightOpening>();
    const w = wiring({ blockOpening: () => slow.promise, linkedPdf: async () => null });
    clickLink(w, {
      pane: 0,
      target: 'The Lantern Keepers',
      heading: '#^k3x9q2',
      how: 'here',
      inPeek: false,
    });
    // Before the read comes back, they open another note in the same pane.
    followLink(w, { pane: 0, target: 'Elsewhere' });
    await flush();
    expect(placesOf(w.store)).toEqual([{ kind: 'note', path: ELSEWHERE }]);

    slow.resolve({ kind: 'reader', source: 'pdf', document: PDF, highlightId: 'k3x9q2' });
    await flush();
    expect(placesOf(w.store)).toEqual([{ kind: 'note', path: ELSEWHERE }]);
  });

  it('does not open in a pane that was closed, nor in the one that took its number', async () => {
    const slow = deferred<HighlightOpening>();
    const w = wiring({ blockOpening: () => slow.promise, linkedPdf: async () => null });
    splitPane(w.store, 0);
    openNote(w.store, ELSEWHERE);
    clickLink(w, {
      pane: 1,
      target: 'The Lantern Keepers',
      heading: '#^k3x9q2',
      how: 'here',
      inPeek: false,
    });
    closePane(w.store, 1);
    const before = placesOf(w.store, 0);
    slow.resolve({ kind: 'reader', source: 'pdf', document: PDF, highlightId: 'k3x9q2' });
    await flush();
    // The pane the click was made in is gone: nothing else is replaced in its stead.
    expect(placesOf(w.store, 0)).toEqual(before);
  });
});

describe('ordinary links, as before #506', () => {
  it('[[Budget review.pdf]] opened the note named so when no link places were wired (the old rule)', () => {
    const w = wiring(null, [PLAN, NOTE_NAMED_PDF]);
    followLink(w, { pane: 0, target: 'Budget review.pdf' });
    expect(placesOf(w.store)).toEqual([{ kind: 'note', path: NOTE_NAMED_PDF }]);
  });

  it('[[Budget review.pdf]] still opens the note named so, not a reader on a file that is not there', async () => {
    // A note whose title ends in ".pdf" (a meeting about a document, say).
    // With no PDF of that name in the vault, the application reads the link
    // as the path it writes, as `linkedPdf` does.
    const w = wiring(
      {
        blockOpening: async ({ note, blockId }) => ({ kind: 'note', note, blockId }),
        linkedPdf: async (target) => createVaultPath(target),
      },
      [PLAN, NOTE_NAMED_PDF],
    );
    followLink(w, { pane: 0, target: 'Budget review.pdf' });
    await flush();
    expect(placesOf(w.store)).toEqual([{ kind: 'note', path: NOTE_NAMED_PDF }]);
  });
});

describe('the highlight a reader tab holds, when the tab moves to another PDF', () => {
  const A = createVaultPath('Library/the-lantern-keepers.pdf');
  const B = createVaultPath('Library/brightwater.pdf');

  it('is not carried to the next document, nor shown again on coming back', () => {
    const reveals = createRevealStore();
    const { result, rerender } = renderHook(
      ({ path }) => useHeldReveal(useTabReveal(reveals, { tab: 'tab-1', path })),
      { initialProps: { path: A as VaultPath } },
    );
    requestReveal(reveals, { tab: 'tab-1', path: A, fragment: { kind: 'block', id: 'k3x9q2' } });
    rerender({ path: A });
    expect(result.current).toMatchObject({ id: 'k3x9q2' });

    // The same tab opens B (the container is kept, keyed by tab), then goes back to A.
    rerender({ path: B });
    expect(result.current).toBeNull();
    rerender({ path: A });
    // The ask was spent on A: coming back must not jump and flash it again.
    expect(result.current).toBeNull();
  });
});

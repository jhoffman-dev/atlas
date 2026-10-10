import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Editor } from '@tiptap/core';
import {
  locateFragment,
  type EditorDocument,
  type LinkFragment,
  type Transclusion,
  type WikiLink,
} from '@atlas/domain';
import type { BookmarkSource } from './editor/bookmark.tsx';
import type { TransclusionSource } from './editor/block-embed.tsx';
import type { QueryBlockShown, QueryBlockSource } from './editor/query-block.tsx';
import type { BlockPicking } from './editor/block-picking.ts';
import { positionOf } from './editor/block-link-commands.ts';
import { markRevealed } from './editor/revealed-block.ts';
import type { BookmarkPreview } from './bookmark-card.tsx';

/*
 * What the note's editor is handed by the page, made stable: each is built
 * once and reads the page's latest callbacks through a ref, since a new one
 * on every render would rebuild the editor under the caret.
 */

/** Where the note's bookmark cards read the notes they link to. */
export interface NoteBookmarks {
  /** What a card shows of the note a link opens. */
  readonly load: (link: WikiLink) => Promise<BookmarkPreview>;
  /** Changes whenever a card may show something new — any note saved — so each is read again. */
  readonly revision: unknown;
}

/** Where the note's shown blocks (P26-03) read the blocks they show. */
export interface NoteTransclusions {
  /** What an embed shows of the block its link names. */
  readonly load: (link: WikiLink) => Promise<Transclusion>;
  /** A picture in a shown block, found beside the note the block is in. */
  readonly loadImage: (args: { path: string; src: string }) => Promise<string | null>;
  /** Changes whenever a shown block may show something new — any note saved — so each is read again. */
  readonly revision: unknown;
}

/** Where the note's query blocks (P30-05) are answered, `this` being the note. */
export interface NoteQueryBlocks {
  /** What a block holding `text` shows. */
  readonly run: (text: string) => Promise<QueryBlockShown>;
  /** Opens a note one of a block's rows names. */
  readonly onOpenNote: (path: string) => void;
  /** Changes whenever an answer may have changed — the index refreshed — so each is asked again. */
  readonly revision: unknown;
}

/** A ref that always holds the latest value, so a callback built once can call it. */
export function useLatest<Value>(value: Value) {
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
  return latest;
}

/** A `subscribe` whose listeners are called whenever `revision` changes. */
function useRevision(revision: unknown): (listener: () => void) => () => void {
  const listeners = useRef(new Set<() => void>());
  const seen = useRef(revision);
  useEffect(() => {
    if (Object.is(seen.current, revision)) return;
    seen.current = revision;
    for (const listener of listeners.current) listener();
  }, [revision]);
  return useCallback((listener: () => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);
}

/** The editor's bookmark source: cards read through the latest `load`, and again on each revision. */
export function useBookmarkSource(bookmarks: NoteBookmarks | undefined): BookmarkSource | null {
  const latest = useLatest(bookmarks);
  const subscribe = useRevision(bookmarks?.revision);
  const hasBookmarks = bookmarks !== undefined;
  return useMemo<BookmarkSource | null>(
    () =>
      hasBookmarks
        ? {
            load: (link) =>
              latest.current === undefined
                ? Promise.reject(new Error('Bookmarks cannot be read here.'))
                : latest.current.load(link),
            subscribe,
          }
        : null,
    [hasBookmarks, latest, subscribe],
  );
}

/** The editor's source of shown blocks, as `useBookmarkSource` is of cards. */
export function useTransclusionSource(
  transclusions: NoteTransclusions | undefined,
): TransclusionSource | null {
  const latest = useLatest(transclusions);
  const subscribe = useRevision(transclusions?.revision);
  const has = transclusions !== undefined;
  return useMemo<TransclusionSource | null>(
    () =>
      has
        ? {
            load: (link) =>
              latest.current === undefined
                ? Promise.reject(new Error('Blocks cannot be shown here.'))
                : latest.current.load(link),
            loadImage: (args) => latest.current?.loadImage(args) ?? Promise.resolve(null),
            subscribe,
          }
        : null,
    [has, latest, subscribe],
  );
}

/** The editor's source of query answers, as `useTransclusionSource` is of shown blocks. */
export function useQueryBlockSource(queries: NoteQueryBlocks | undefined): QueryBlockSource | null {
  const latest = useLatest(queries);
  const subscribe = useRevision(queries?.revision);
  const has = queries !== undefined;
  return useMemo<QueryBlockSource | null>(
    () =>
      has
        ? {
            run: (text) =>
              latest.current === undefined
                ? Promise.reject(new Error('Queries cannot be run here.'))
                : latest.current.run(text),
            onOpenNote: (path) => latest.current?.onOpenNote(path),
            subscribe,
          }
        : null,
    [has, latest, subscribe],
  );
}

/** The picker's side of linking blocks, reading the page's latest callbacks. */
export function useBlockPicking(picking: BlockPicking | undefined): BlockPicking | null {
  const latest = useLatest(picking);
  const has = picking !== undefined;
  return useMemo<BlockPicking | null>(
    () =>
      has
        ? {
            choicesFor: (target) => latest.current?.choicesFor(target) ?? Promise.resolve(null),
            anchor: (block) =>
              latest.current === undefined
                ? Promise.reject(new Error('Blocks cannot be linked here.'))
                : latest.current.anchor(block),
            newId: (taken) => {
              if (latest.current === undefined) throw new Error('Blocks cannot be linked here.');
              return latest.current.newId(taken);
            },
            onRefused: (reason) => latest.current?.onRefused(reason),
          }
        : null,
    [has, latest],
  );
}

/** How long a revealed block stays marked, so the eye finds it. */
const REVEALED_FOR_MS = 1600;

/**
 * Brings the block or heading `reveal` names into view once the note shows
 * it, and marks it for a moment — where a followed `[[Note#^id]]` pointed.
 * Each `key` is revealed once; a later document for the same key does not
 * scroll the page again.
 */
export function useReveal(
  editor: Editor | null,
  reveal: { fragment: LinkFragment; key: unknown; done?: () => void } | null,
): void {
  const done = useRef<unknown>(undefined);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // Every render: the note may arrive after the request to reveal a block in it.
  useEffect(() => {
    if (editor === null || reveal === null || Object.is(done.current, reveal.key)) return;
    const at = locateFragment(editor.getJSON() as EditorDocument, reveal.fragment);
    const position = at === null ? null : positionOf(editor.state.doc, at);
    const element = position === null ? null : editor.view.nodeDOM(position);
    if (position === null || !(element instanceof HTMLElement)) return;
    done.current = reveal.key;
    element.scrollIntoView({ block: 'center' });
    markRevealed(editor, position);
    reveal.done?.();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (!editor.isDestroyed) markRevealed(editor, null);
    }, REVEALED_FOR_MS);
  });
}

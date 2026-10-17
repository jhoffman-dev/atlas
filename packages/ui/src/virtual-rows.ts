import { useCallback, useState, type FocusEvent, type RefObject } from 'react';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { useScrollMargin } from './scroll-margin.ts';

/** A row the list puts in the page, and the room left above it for the rows it does not. */
export interface PlacedRow {
  readonly key: string;
  readonly index: number;
  /** Height of the rows between this one and the one placed before it (or the list's top). */
  readonly gapBefore: number;
}

export interface VirtualRowsOptions {
  /** The element the rows start in, so they are placed below what sits above it. */
  readonly content: RefObject<HTMLElement | null>;
  /** Each row's key, top to bottom. */
  readonly keys: readonly string[];
  /** The element the page scrolls in, shared with whatever sits around the list; null until mounted. */
  readonly scroller: HTMLElement | null;
  /** A row's height before it is measured. */
  readonly estimate: (index: number) => number;
  /**
   * The attribute a placed row carries its index in, which is how it is
   * measured and how focus inside it is traced back to it. Lists nested in
   * one another each need their own.
   */
  readonly indexAttribute?: string;
  /** Rows placed beyond each edge of what is shown. */
  readonly overscan?: number;
  /** A row to place wherever it is scrolled to: one the page is about to focus. */
  readonly pinned?: string | null;
}

export interface VirtualRows {
  readonly placed: readonly PlacedRow[];
  /** Height of the rows after the last one placed. */
  readonly after: number;
  /** For each placed row's element, carrying its index in `indexAttribute`: a row is placed by its own height. */
  readonly measure: (element: Element | null) => void;
  /** For the element around the rows: the row focus is in stays placed, with a row either side of it. */
  readonly onFocus: (event: FocusEvent<HTMLElement>) => void;
}

/**
 * A long list that puts in the page only the rows near what the scroller
 * shows, so a list of hundreds costs what a screenful does (#238).
 *
 * The row that has the focus is kept placed however far it is scrolled away,
 * and so are its neighbours: Tab and Shift+Tab move to the next row before
 * anything has scrolled, so every row can be reached from the keyboard
 * (#167). A row asked for by `pinned` is placed too, for the page to focus;
 * focusing it scrolls it into view.
 */
export function useVirtualRows({
  content,
  keys,
  scroller,
  estimate,
  indexAttribute = 'data-index',
  overscan = 12,
  pinned = null,
}: VirtualRowsOptions): VirtualRows {
  const scrollMargin = useScrollMargin(content, scroller);
  const [focused, setFocused] = useState<string | null>(null);
  const held = [focused, pinned].map((key) => (key === null ? -1 : keys.indexOf(key)));
  const getItemKey = useCallback((index: number) => keys[index] ?? index, [keys]);
  const virtualizer = useVirtualizer({
    count: keys.length,
    getScrollElement: () => scroller,
    estimateSize: estimate,
    getItemKey,
    overscan,
    indexAttribute,
    scrollMargin,
    // Starts from where the scroller already is: the virtualiser otherwise
    // scrolls it to 0 as it attaches, and lists mount while the page is scrolled.
    initialOffset: () => scroller?.scrollTop ?? 0,
    rangeExtractor: (range: Range) => withHeld(defaultRangeExtractor(range), held, range.count),
    // jsdom reports a zero-height scroller, which would place no rows at all.
    initialRect: { width: 960, height: 880 },
  });

  const onFocus = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      const index = event.target.closest(`[${indexAttribute}]`)?.getAttribute(indexAttribute);
      const key = index === undefined || index === null ? undefined : keys[Number(index)];
      if (key !== undefined) setFocused(key);
    },
    [indexAttribute, keys],
  );

  const items = virtualizer.getVirtualItems();
  const placed: PlacedRow[] = [];
  let end = scrollMargin;
  for (const item of items) {
    placed.push({ key: String(item.key), index: item.index, gapBefore: item.start - end });
    end = item.end;
  }
  const after = virtualizer.getTotalSize() - (end - scrollMargin);
  return { placed, after, measure: virtualizer.measureElement, onFocus };
}

/** The range's rows, and each held row with the row either side of it. */
function withHeld(indexes: number[], held: readonly number[], count: number): number[] {
  const wanted = new Set(indexes);
  for (const index of held) {
    if (index < 0) continue;
    for (const near of [index - 1, index, index + 1]) {
      if (near >= 0 && near < count) wanted.add(near);
    }
  }
  return wanted.size === indexes.length ? indexes : [...wanted].sort((a, b) => a - b);
}

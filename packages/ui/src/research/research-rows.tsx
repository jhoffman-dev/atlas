import { Fragment, useMemo, useRef, type ReactNode } from 'react';
import { useVirtualRows } from '../virtual-rows.ts';

/** What a row is handed to place itself: its index, for `data-index`, and the ref that measures it. */
export interface RowPlace {
  readonly index: number;
  readonly measure: (element: Element | null) => void;
}

/**
 * A research list's rows (#507), virtualised: only those near what the page's
 * scroller shows are in the page, so 20,000 highlights cost what a screenful
 * does, and gaps above and below keep the scrollbar true. The page around it
 * provides the scroller (`RowScrollerContext`), as the Inbox and Today do.
 */
export function ResearchRows<Item>({
  items,
  keyOf,
  estimate,
  label,
  renderRow,
}: {
  items: readonly Item[];
  keyOf: (item: Item) => string;
  /** A row's height before it is measured. */
  estimate: number;
  label: string;
  renderRow: (item: Item, place: RowPlace) => ReactNode;
}) {
  const content = useRef<HTMLUListElement>(null);
  const keys = useMemo(() => items.map(keyOf), [items, keyOf]);
  const list = useVirtualRows({ content, keys, estimate: () => estimate });
  return (
    <ul ref={content} className="research__rows" aria-label={label} onFocus={list.onFocus}>
      {list.placed.map(({ key, index, gapBefore }) => {
        const item = items[index];
        if (item === undefined) return null;
        return (
          <Fragment key={key}>
            {gapBefore > 0 && <Gap height={gapBefore} />}
            {renderRow(item, { index, measure: list.measure })}
          </Fragment>
        );
      })}
      {list.after > 0 && <Gap height={list.after} />}
    </ul>
  );
}

function Gap({ height }: { height: number }) {
  return <li aria-hidden="true" className="research__gap" style={{ height }} />;
}

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createVaultPath, type SidebarTreeRow } from '@atlas/domain';
import { offsetWithin } from './scroll-margin.ts';
import { VaultTree } from './vault-tree.tsx';

// jsdom lays nothing out, so where each element sits is given to it here:
// `offsets` maps an element to its offsetTop, and every element's offset
// parent is its parent element, as if each were positioned.
const offsets = new Map<Element, number>();
const realOffsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop');
const realOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');

function placeElements(offsetOf: (element: HTMLElement) => number) {
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      return offsetOf(this);
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) {
      return this.parentElement;
    },
  });
}

afterEach(() => {
  offsets.clear();
  if (realOffsetTop) Object.defineProperty(HTMLElement.prototype, 'offsetTop', realOffsetTop);
  if (realOffsetParent) {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', realOffsetParent);
  }
});

describe('offsetWithin', () => {
  it('adds up the offsets from the element to the scroller', () => {
    placeElements((element) => offsets.get(element) ?? 0);
    const scroller = document.createElement('div');
    const section = document.createElement('section');
    const tree = document.createElement('div');
    scroller.append(section);
    section.append(tree);
    offsets.set(section, 120).set(tree, 24);

    expect(offsetWithin(tree, scroller)).toBe(144);
  });

  it('is 0 for an element that is not inside the scroller', () => {
    placeElements(() => 50);
    const scroller = document.createElement('div');
    const elsewhere = document.createElement('div');
    document.createElement('div').append(elsewhere);

    expect(offsetWithin(elsewhere, scroller)).toBe(0);
  });
});

const fileRow = (at: number): SidebarTreeRow => ({
  entry: { kind: 'file', name: `n${at}.md`, path: createVaultPath(`n${at}.md`) },
  depth: 0,
  isExpanded: false,
  isLoaded: true,
  label: `Note ${at}`,
  icon: 'doc',
  opensArchive: false,
});

const noop = () => {};

/** A tree 300px down a shared scroller, the way Pages sits below the other sections. */
function SharedTree({ rows }: { rows: readonly SidebarTreeRow[] }) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setScroller}>
      <div className="above" />
      <VaultTree
        rows={rows}
        open={new Set()}
        starred={new Set()}
        onToggleDirectory={noop}
        onSelectFile={noop}
        onToggleFavorite={noop}
        scrollParent={scroller}
      />
    </div>
  );
}

describe('VaultTree in a scroller it shares', () => {
  const rows = Array.from({ length: 60 }, (_, at) => fileRow(at));

  it('places its first row at its own top, not where it starts in the scroller', () => {
    placeElements((element) => (element.classList.contains('tree') ? 300 : 0));
    render(<SharedTree rows={rows} />);

    const first = screen.getByRole('treeitem', { name: /Note 0\b/ });
    expect(first.style.transform).toBe('translateY(0px)');
  });

  it('renders the rows the scroller can show below what sits above it, and no more', () => {
    placeElements((element) => (element.classList.contains('tree') ? 300 : 0));
    render(<SharedTree rows={rows} />);

    // The setup's scroller is 800px tall; the tree starts 300px down, so 500px
    // of it — 17 rows — can be on screen, plus the 12 the virtualiser keeps
    // either side. Counted as if the tree started at the top, it would be 39.
    expect(screen.getAllByRole('treeitem')).toHaveLength(17 + 12);
  });

  it('is not a scroller of its own', () => {
    render(<SharedTree rows={rows} />);
    expect(document.querySelector('.tree')?.classList.contains('tree--shared')).toBe(true);
  });
});

describe('VaultTree when what sits above it changes height', () => {
  const rows = Array.from({ length: 60 }, (_, at) => fileRow(at));
  /** Every ResizeObserver made, its callback and what it watches. */
  const observers: { callback: ResizeObserverCallback; watched: Set<Element> }[] = [];

  function watchResizes() {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        readonly watched = new Set<Element>();
        constructor(callback: ResizeObserverCallback) {
          observers.push({ callback, watched: this.watched });
        }
        observe(target: Element) {
          this.watched.add(target);
        }
        unobserve(target: Element) {
          this.watched.delete(target);
        }
        disconnect() {
          this.watched.clear();
        }
      },
    );
  }

  /** What the browser does when `target` changes size: tells whoever watches it. */
  function resize(target: Element) {
    act(() => {
      for (const { callback, watched } of observers) {
        if (!watched.has(target)) continue;
        const entry = { target } as ResizeObserverEntry;
        callback([entry], {} as ResizeObserver);
      }
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    observers.length = 0;
  });

  it('places its rows again when content above grows, without the sidebar re-rendering', () => {
    watchResizes();
    let treeTop = 300;
    placeElements((element) => (element.classList.contains('tree') ? treeTop : 0));
    const { container } = render(<SharedTree rows={rows} />);
    expect(screen.getAllByRole('treeitem')).toHaveLength(17 + 12);

    // A row above wraps once a font arrives: the tree is now 600px down.
    treeTop = 600;
    resize(container.querySelector('.above')!);

    // 200px of an 800px scroller is left for it: 7 rows, plus the 12 kept either side.
    expect(screen.getAllByRole('treeitem')).toHaveLength(7 + 12);
  });

  it('keeps the rows in view where they were when content above grows while scrolled into the tree', () => {
    watchResizes();
    let treeTop = 300;
    placeElements((element) => (element.classList.contains('tree') ? treeTop : 0));
    const { container } = render(<SharedTree rows={rows} />);
    const scroller = container.firstElementChild as HTMLElement;
    scroller.scrollTop = 900;
    fireEvent.scroll(scroller);

    // A favourite is added above: the tree moves 31px down the scroller.
    treeTop = 331;
    resize(container.querySelector('.above')!);

    // Scrolled by as much, so the row under the pointer is still under it.
    expect(scroller.scrollTop).toBe(931);
  });

  it('leaves the scroll alone when the tree starts below the top of what is shown', () => {
    watchResizes();
    let treeTop = 300;
    placeElements((element) => (element.classList.contains('tree') ? treeTop : 0));
    const { container } = render(<SharedTree rows={rows} />);
    const scroller = container.firstElementChild as HTMLElement;
    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);

    treeTop = 260;
    resize(container.querySelector('.above')!);

    // What was shut or shrank is in view above the tree; it moves, the scroll does not.
    expect(scroller.scrollTop).toBe(100);
  });
});

// @vitest-environment jsdom
/**
 * Second attack on #130 (PR #283): "New above" when the person is scrolled
 * well down the list, not at its top. The table is given a 1500px band here
 * (the fake layout honours a px `style.height`), so the list is taller than
 * the 200px view and can be scrolled into.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createVaultPath, type InboxItem } from '@atlas/domain';
import { InboxPage, type InboxContents, type InboxPageProps } from './inbox-page.tsx';
import { installFakeLayout, type FakeLayout } from './testing/fake-layout.ts';

const ROWS = 30;

const item = (n: number): InboxItem => ({
  path: createVaultPath(`Inbox/Item ${n}.md`),
  title: `Item ${n}`,
  type: null,
  arrivedIn: '',
  importOutcome: null,
  importError: null,
  task: null,
});

const CONTENTS: InboxContents = {
  items: Array.from({ length: ROWS }, (_, n) => item(n + 1)),
  truncated: false,
  total: ROWS,
};

const TYPES_OFFER: NonNullable<InboxPageProps['typesOffer']> = {
  lines: ['Task gains Project, linking project or area notes.'],
  onAccept: vi.fn(),
  onDismiss: vi.fn(),
};

function page() {
  const props: InboxPageProps = {
    contents: CONTENTS,
    error: null,
    filing: [],
    people: [],
    onOpen: vi.fn(),
    onShowSidebar: vi.fn(),
    onShowMore: vi.fn(),
    onClarify: vi.fn(async () => true),
    busy: false,
    problem: null,
  };
  const view = render(<InboxPage {...props} />);
  return (next: Partial<InboxPageProps>) => view.rerender(<InboxPage {...props} {...next} />);
}

let layout: FakeLayout;
beforeEach(() => {
  layout = installFakeLayout({
    blocks: '.page-head, .inbox__offer, .proposals, .table__error, .inbox__done',
    scroller: '.panel__body--rows',
  });
});
afterEach(() => layout.restore());

const offer = () => screen.getByRole('complementary', { name: 'Set your types up for the Inbox' });
const newAbove = () => screen.queryByRole('button', { name: /New above/ });
const inView = (element: Element) => {
  const top = layout.topOf(element);
  return top >= 0 && top < 200;
};

/** Opens the page, scrolls `by` down the list, and has the types offer arrive above it. */
function arriveWhileScrolled(by: number) {
  const rerender = page();
  document.querySelector<HTMLElement>('.table')!.style.height = '1500px';
  layout.flush();
  act(() => {
    layout.scroller().scrollTop = by;
  });
  rerender({ typesOffer: TYPES_OFFER });
  layout.flush();
}

describe('"New above" while scrolled down the list (#130 attack)', () => {
  it('takes the person to what arrived above when clicked', () => {
    arriveWhileScrolled(600);
    expect(layout.scroller().scrollTop).toBe(650);
    expect(newAbove()).not.toBeNull();
    expect(inView(offer())).toBe(false);
    fireEvent.click(newAbove()!);
    expect(inView(offer())).toBe(true);
  });

  it('stays while what arrived above is still out of view', () => {
    arriveWhileScrolled(600);
    expect(newAbove()).not.toBeNull();
    // Up by the arrival and a little more: back where the rows were, nowhere near the offer.
    act(() => {
      layout.scroller().scrollTop -= 60;
    });
    expect(inView(offer())).toBe(false);
    expect(newAbove()).not.toBeNull();
  });
});

describe('the undo bar going on its own while scrolled down the list (#130 attack)', () => {
  it('leaves the rows where they are on screen', () => {
    const rerender = page();
    document.querySelector<HTMLElement>('.table')!.style.height = '1500px';
    layout.flush();
    act(() => {
      layout.scroller().scrollTop = 600;
    });
    const lastAction = { title: 'Item 3' };
    rerender({ lastAction, onUndo: vi.fn(), onDismissLastAction: vi.fn() });
    layout.flush();
    const table = document.querySelector('.table')!;
    const before = layout.topOf(table);
    // Its 20 seconds are up: nothing the person did, so nothing should move under them.
    rerender({ lastAction: null });
    layout.flush();
    expect(layout.topOf(table)).toBe(before);
  });
});

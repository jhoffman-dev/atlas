// @vitest-environment jsdom
/**
 * #130: the Inbox holds its rows where they are on screen as what sits above
 * them arrives — manual scroll anchoring, through `useListAnchor` — except
 * for what answers the person, and except while they are on an offer. jsdom
 * lays nothing out, so a fake layout stacks the page's blocks 50px apart.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createVaultPath, type InboxItem } from '@dfai/domain';
import { InboxPage, type InboxContents, type InboxPageProps } from './inbox-page.tsx';
import { installFakeLayout, type FakeLayout } from './testing/fake-layout.ts';

const item = (path: string, title: string): InboxItem => ({
  path: createVaultPath(path),
  title,
  type: null,
  arrivedIn: '',
  importOutcome: null,
  importError: null,
  task: null,
});

const CONTENTS: InboxContents = {
  items: [item('Inbox/Idea.md', 'Idea'), item('Inbox/Plan.md', 'Plan')],
  truncated: false,
  total: 2,
};

const TIDY: NonNullable<InboxPageProps['vaultTidy']> = {
  preview: { moves: [{ from: 'Loose idea.md', to: 'Notes/2026/Loose idea.md' }], refused: [] },
  open: false,
  busy: false,
  result: null,
  problem: null,
  onOpen: vi.fn(),
  onApply: vi.fn(),
  onClose: vi.fn(),
  onDismiss: vi.fn(),
};

const TYPES_OFFER: NonNullable<InboxPageProps['typesOffer']> = {
  lines: ['Task gains Project, linking project or area notes.'],
  onAccept: vi.fn(),
  onDismiss: vi.fn(),
};

function page(overrides: Partial<InboxPageProps> = {}) {
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
    ...overrides,
  };
  const view = render(<InboxPage {...props} />);
  return (next: Partial<InboxPageProps>) => view.rerender(<InboxPage {...props} {...next} />);
}

let layout: FakeLayout;
beforeEach(() => {
  layout = installFakeLayout({
    blocks: '.page-head, .inbox__offer, .proposals, .table__error, .table',
    scroller: '.panel__body--rows',
  });
});
afterEach(() => layout.restore());

const firstRow = () => screen.getByRole('button', { name: 'Idea' });
const tidyOffer = () => screen.getByRole('region', { name: 'Tidy the vault' });
const newAbove = () => screen.queryByRole('button', { name: /New above/ });
/** Lays the change out, then says where the first row is on screen. */
const settledRowAt = () => {
  layout.flush();
  return layout.topOf(firstRow());
};

describe('useListAnchor in the Inbox (#130)', () => {
  // The page's heading is in its bar since UI slice 3b, out of the scroller: an offer
  // arriving at the top of the page is scrolled out of view as the rows are held.
  it('holds the rows still as an offer arrives above them, and says so as it is out of view', () => {
    const rerender = page();
    const before = settledRowAt();
    rerender({ typesOffer: TYPES_OFFER });
    expect(settledRowAt()).toBe(before);
    expect(layout.scroller().scrollTop).toBe(50);
    expect(layout.topOf(screen.getByRole('complementary', { name: /Set your types up/ }))).toBe(
      -50,
    );
    expect(newAbove()).not.toBeNull();
  });

  it('holds the rows still as an offer arrives below one already shown; landing in view, it is not "New above"', () => {
    const rerender = page({ vaultTidy: TIDY });
    const before = settledRowAt();
    // Read after the tidy, the types offer goes below it: the tidy scrolls away, the new one is in view.
    rerender({ vaultTidy: TIDY, typesOffer: TYPES_OFFER });
    expect(settledRowAt()).toBe(before);
    expect(layout.scroller().scrollTop).toBe(50);
    expect(layout.topOf(screen.getByRole('complementary', { name: /Set your types up/ }))).toBe(0);
    expect(newAbove()).toBeNull();
  });

  it('scrolls to what arrived out of view when asked, and the notice goes', () => {
    const rerender = page();
    document.querySelector<HTMLElement>('.table')!.style.height = '1500px';
    layout.flush();
    act(() => {
      layout.scroller().scrollTop = 600;
    });
    rerender({ typesOffer: TYPES_OFFER });
    layout.flush();
    fireEvent.click(newAbove()!);
    // The offer stands at the top of the page; taken there.
    expect(layout.scroller().scrollTop).toBe(0);
    expect(newAbove()).toBeNull();
  });

  it('takes back the room it made once the person scrolls back up', () => {
    const rerender = page();
    settledRowAt();
    rerender({ typesOffer: TYPES_OFFER });
    layout.flush();
    const room = document.querySelector<HTMLElement>('.panel__body--rows > [aria-hidden="true"]');
    // Offer and list fill 100px of a 200px view: scrolling 50px down needs 150px more.
    expect(room?.style.height).toBe('150px');
    act(() => {
      layout.scroller().scrollTop = 0;
    });
    // Given back down to what fills the view at the top: nothing is left to scroll into.
    expect(room?.style.height).toBe('100px');
    expect(layout.scroller().scrollHeight - layout.scroller().clientHeight).toBe(0);
  });

  it('holds the offer the pointer is on instead of the rows', () => {
    const rerender = page({ vaultTidy: TIDY });
    settledRowAt();
    fireEvent.pointerOver(tidyOffer());
    const tidyAt = layout.topOf(tidyOffer());
    // Read after the tidy, the types offer goes below it: the tidy stays put under the pointer.
    rerender({ vaultTidy: TIDY, typesOffer: TYPES_OFFER });
    layout.flush();
    expect(layout.topOf(tidyOffer())).toBe(tidyAt);
    expect(layout.scroller().scrollTop).toBe(0);
    expect(newAbove()).toBeNull();
  });

  it('holds the rows again once the pointer leaves the page', () => {
    const rerender = page({ vaultTidy: TIDY });
    const before = settledRowAt();
    fireEvent.pointerOver(tidyOffer());
    fireEvent.pointerLeave(screen.getByRole('article', { name: 'Inbox' }));
    rerender({ vaultTidy: TIDY, typesOffer: TYPES_OFFER });
    expect(settledRowAt()).toBe(before);
  });

  it('scrolls nothing while the rows are still held back for the offers', () => {
    const reading = { ...TIDY, preview: null, reading: true };
    const rerender = page({ vaultTidy: reading });
    layout.flush();
    rerender({ vaultTidy: reading, typesOffer: TYPES_OFFER });
    layout.flush();
    expect(layout.scroller().scrollTop).toBe(0);
  });
});

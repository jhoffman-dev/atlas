// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import type { InboxPageProps } from '@atlas/ui';
import { render, screen } from '@testing-library/react';
import { pageForPlace, type PageProps } from './main-route.tsx';

// Pages that are not drawn are never handed anything, so what they would be does not matter.
const unused = {} as never;

/** Every page's props, Terms the only one with real ones; nothing is preloaded here. */
function pages(): PageProps {
  return {
    graph: unused,
    type: { ...(unused as PageProps['type']), table: { type: null } as PageProps['type']['table'] },
    query: unused,
    tags: unused,
    archive: unused,
    inbox: unused,
    review: unused,
    today: unused,
    automations: unused,
    activity: unused,
    templates: unused,
    terms: {
      contents: { terms: [], conflicts: [], warnings: [] } as never,
      error: null,
      onAdd: vi.fn(),
      onEditVariants: vi.fn(),
      onOpen: vi.fn(),
    },
  };
}

const chrome = {
  history: { back: 'Today', forward: null, onBack: vi.fn(), onForward: vi.fn() },
};

describe('pageForPlace', () => {
  it('draws a page that has not loaded yet in its frame, then the page in it', async () => {
    const { container } = render(
      <>{pageForPlace({ place: { kind: 'terms' }, pages: pages(), chrome })}</>,
    );
    // The frame first: the bar with Back and Forward, over a body still loading.
    expect(screen.getByRole('group', { name: 'History' })).toBeDefined();
    expect(container.querySelector('.panel__body[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector('.terms')).toBeNull();

    expect(
      await screen.findByRole('heading', { name: 'All terms' }, { timeout: 15_000 }),
    ).toBeDefined();
    expect(container.querySelector('.panel__body[aria-busy="true"]')).toBeNull();
    expect(screen.getByRole('group', { name: 'History' })).toBeDefined();
  }, 20_000);

  it('draws a type page only once its table is that type’s, keeping the frame till then', () => {
    const { container } = render(
      <>{pageForPlace({ place: { kind: 'type', name: 'task' }, pages: pages(), chrome })}</>,
    );
    expect(container.querySelector('.panel__body[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByRole('group', { name: 'History' })).toBeDefined();
  });
});

/**
 * #130: the Inbox page is keyed by its vault, so another vault opening with
 * the Inbox open starts the page afresh — its rows held back for that vault's
 * own offers — rather than keeping what the last vault's page had decided.
 */
const PAGE: InboxPageProps = {
  contents: {
    items: [
      {
        path: createVaultPath('Inbox/Idea.md'),
        title: 'Idea',
        type: null,
        arrivedIn: '',
        importOutcome: null,
        importError: null,
        task: null,
      },
    ],
    truncated: false,
    total: 1,
  },
  error: null,
  filing: [],
  onOpen: vi.fn(),
  onShowMore: vi.fn(),
  onClarify: vi.fn(async () => true),
  busy: false,
  problem: null,
};

const TIDY_READING: NonNullable<InboxPageProps['vaultTidy']> = {
  preview: null,
  reading: true,
  open: false,
  busy: false,
  result: null,
  problem: null,
  onOpen: vi.fn(),
  onApply: vi.fn(),
  onClose: vi.fn(),
  onDismiss: vi.fn(),
};

/** The Inbox page, as the tab showing it draws it, for the vault `vaultKey`. */
const route = (vaultKey: string, page: InboxPageProps) =>
  pageForPlace({
    place: { kind: 'inbox' },
    pages: { ...pages(), inbox: { ...page, vaultKey } },
    chrome,
  });

const rowHeld = () => screen.getByText('Idea').closest('[inert]') !== null;

describe('pageForPlace — the Inbox page for another vault (#130)', () => {
  it('starts afresh, holding its rows while that vault’s offers are read', () => {
    const view = render(<>{route('/vaults/home', PAGE)}</>);
    expect(rowHeld()).toBe(false);
    view.rerender(<>{route('/vaults/work', { ...PAGE, vaultTidy: TIDY_READING })}</>);
    expect(rowHeld()).toBe(true);
  });
});

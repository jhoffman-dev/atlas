// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import type { InboxPageProps } from '@atlas/ui';
import { render, screen } from '@testing-library/react';
import { mainRoute } from './main-route.tsx';

type RouteArgs = Parameters<typeof mainRoute>[0];

// Pages that are closed are never drawn, so what they would be handed does not matter.
const unused = {} as never;

/** Every page closed but Terms, which loads on first use; nothing is preloaded here. */
function termsOpen(): RouteArgs {
  return {
    graph: { ...(unused as RouteArgs['graph']), scope: null },
    type: { ...(unused as RouteArgs['type']), table: { type: null } as RouteArgs['type']['table'] },
    query: { open: false, screen: unused },
    tags: { selected: undefined, screen: unused },
    archive: { open: false, page: unused },
    inbox: { open: false, vaultKey: null, page: unused },
    review: { open: false, page: unused },
    today: { open: false, page: unused },
    automations: { open: false, screen: unused },
    activity: { open: false, screen: unused },
    templates: { open: false, page: unused },
    terms: {
      open: true,
      page: {
        contents: { terms: [], conflicts: [], warnings: [] } as never,
        error: null,
        onAdd: vi.fn(),
        onEditVariants: vi.fn(),
        onOpen: vi.fn(),
      },
    },
    history: { back: 'Today', forward: null, onBack: vi.fn(), onForward: vi.fn() },
  };
}

describe('mainRoute', () => {
  it('draws a page that has not loaded yet in its frame, then the page in it', async () => {
    const { container } = render(<>{mainRoute(termsOpen())}</>);
    // The frame first: the bar with Back and Forward, over a body still loading.
    expect(screen.getByRole('group', { name: 'History' })).toBeDefined();
    expect(container.querySelector('.panel__body[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector('.terms')).toBeNull();

    expect(
      await screen.findByRole('heading', { name: 'Terms' }, { timeout: 15_000 }),
    ).toBeDefined();
    expect(container.querySelector('.panel__body[aria-busy="true"]')).toBeNull();
    expect(screen.getByRole('group', { name: 'History' })).toBeDefined();
  }, 20_000);

  it('leaves the panes when no page is open', () => {
    const args = termsOpen();
    expect(mainRoute({ ...args, terms: { ...args.terms, open: false } })).toBeNull();
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

/** The route with only the Inbox open. */
const route = (vaultKey: string, page: InboxPageProps) =>
  mainRoute({
    graph: { scope: null },
    type: { table: { type: null } },
    query: { open: false },
    tags: { selected: undefined },
    archive: { open: false },
    inbox: { open: true, vaultKey, page },
  } as unknown as Parameters<typeof mainRoute>[0]);

const rowHeld = () => screen.getByText('Idea').closest('[inert]') !== null;

describe('mainRoute — the Inbox page for another vault (#130)', () => {
  it('starts afresh, holding its rows while that vault’s offers are read', () => {
    const view = render(<>{route('/vaults/home', PAGE)}</>);
    expect(rowHeld()).toBe(false);
    view.rerender(<>{route('/vaults/work', { ...PAGE, vaultTidy: TIDY_READING })}</>);
    expect(rowHeld()).toBe(true);
  });
});

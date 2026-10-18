// @vitest-environment jsdom
/**
 * #130: the Inbox page is keyed by its vault, so another vault opening with
 * the Inbox open starts the page afresh — its rows held back for that vault's
 * own offers — rather than keeping what the last vault's page had decided.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createVaultPath } from '@atlas/domain';
import type { InboxPageProps } from '@atlas/ui';
import { mainRoute } from './main-route.tsx';

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

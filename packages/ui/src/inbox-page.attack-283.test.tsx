// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createVaultPath, readProposal, type InboxItem } from '@dfai/domain';
import { InboxPage, type InboxContents, type InboxPageProps } from './inbox-page.tsx';
import { installFakeLayout, type FakeLayout } from './testing/fake-layout.ts';

/**
 * Attack on #130 (PR #283): once the Inbox's rows are drawn, nothing new may
 * go in above them, or a click aimed at a row lands on something else. The
 * PR holds back the five offers; these are the other things drawn above the
 * rows that can still arrive after them.
 *
 * Since the fix round, what arrives late is shown, above the rows as it
 * belongs, and the rows are held where they were on screen instead (manual
 * scroll anchoring, #130). jsdom lays nothing out, so a fake layout stacks
 * the page's blocks 50px apart: the first row must be where it was.
 */

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

function proposalNamed(title: string) {
  const reading = readProposal({
    path: createVaultPath(`Inbox/Proposals/${title}.md`),
    properties: { type: 'proposal', kind: 'task', payload: { title } },
  });
  if (!reading.ok) throw new Error(reading.problem);
  return reading.proposal;
}

const proposals = (
  contents: NonNullable<InboxPageProps['proposals']>['contents'],
): NonNullable<InboxPageProps['proposals']> => ({
  contents,
  error: null,
  notice: null,
  busy: null,
  problems: new Map(),
  onAccept: vi.fn(),
  onReject: vi.fn(),
  onAcceptChoice: vi.fn(),
  selection: { selected: new Set(), onToggle: vi.fn(), onToggleAll: vi.fn() },
  onClearSelection: vi.fn(),
  onAcceptMany: vi.fn(),
  onRejectMany: vi.fn(),
  onDismissNotice: vi.fn(),
  onOpen: vi.fn(),
  onOpenSource: vi.fn(),
});

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

function page(overrides: Partial<InboxPageProps> = {}) {
  const props: InboxPageProps = {
    contents: CONTENTS,
    error: null,
    filing: [],
    people: [],
    onOpen: vi.fn(),
    onShowMore: vi.fn(),
    onClarify: vi.fn(async () => true),
    busy: false,
    problem: null,
    ...overrides,
  };
  const view = render(<InboxPage {...props} />);
  return (next: Partial<InboxPageProps>) => view.rerender(<InboxPage {...props} {...next} />);
}

const firstRow = () => screen.getByRole('button', { name: 'Idea' });

let layout: FakeLayout;
beforeEach(() => {
  layout = installFakeLayout({
    blocks: '.page-head, .inbox__offer, .proposals, .table__error, .table',
    scroller: '.panel__body--rows',
  });
});
afterEach(() => layout.restore());

/** Where the first row is on screen now. */
const firstRowAt = () => layout.topOf(firstRow());
/** After a change, once the browser would have laid it out: whether the first row is where it was. */
const rowStayedAt = (before: number) => {
  layout.flush();
  return firstRowAt() === before;
};

describe('InboxPage — what arrives after the rows are drawn does not go in above them (#130 attack)', () => {
  it('a proposals section read after the rows are drawn is not put above them', () => {
    // No offer is being read, so the rows are drawn at once; the proposals are not read yet.
    const rerender = page({ proposals: proposals(null) });
    layout.flush();
    const before = firstRowAt();

    rerender({
      proposals: proposals({
        open: [proposalNamed('Send the file')],
        stranded: [],
        unreadable: [],
      }),
    });
    expect(screen.getByRole('region', { name: 'Proposals' })).toBeDefined();
    expect(rowStayedAt(before)).toBe(true);
    // At the top of the page (its heading is in the bar since UI slice 3b), it is held
    // out of view above the rows, and said so without moving them.
    expect(screen.queryByRole('button', { name: /New above/ })).not.toBeNull();
  });

  it('the settings-note warning known after the rows are drawn is not put above them', () => {
    const rerender = page();
    layout.flush();
    const before = firstRowAt();

    rerender({
      settingsUnreadable: { problem: 'line 3: a list is not closed', onOpenSettings: vi.fn() },
    });
    expect(screen.getByText(/line 3: a list is not closed/)).toBeDefined();
    expect(rowStayedAt(before)).toBe(true);
  });

  it('the owner-unknown warning known after the rows are drawn is not put above them', () => {
    const rerender = page();
    layout.flush();
    const before = firstRowAt();

    rerender({ ownerUnknown: { onOpenSettings: vi.fn() } });
    expect(
      screen.getByRole('alert', { name: 'DFAI can’t tell which action items are yours' }),
    ).toBeDefined();
    expect(rowStayedAt(before)).toBe(true);
  });

  // Changed in the last fix round: the app keys the Inbox page by its vault
  // (mainRoute), so another vault's page is a new one, never this one's
  // offers read again in place; the dead cache that drew them as they were
  // is gone. The scenario is the app's own: a remount, its rows held.
  it('an offer read again from scratch after the rows are drawn, as on a vault switch, does not land above them', () => {
    // Vault A's tidy is shown and the rows are drawn below it.
    const props: InboxPageProps = {
      contents: CONTENTS,
      error: null,
      filing: [],
      people: [],
      onOpen: vi.fn(),
      onShowMore: vi.fn(),
      onClarify: vi.fn(async () => true),
      busy: false,
      problem: null,
    };
    const view = render(<InboxPage key="/vaults/a" {...props} vaultTidy={TIDY} />);
    expect(screen.getByRole('region', { name: 'Tidy the vault' })).toBeDefined();
    layout.flush();
    const before = firstRowAt();
    // Another vault opens with the Inbox still open: its page starts afresh, its tidy reading…
    view.rerender(
      <InboxPage
        key="/vaults/b"
        {...props}
        vaultTidy={{ ...TIDY, preview: null, reading: true }}
      />,
    );
    // …and is known a moment later, landing above rows that were held back for it.
    view.rerender(<InboxPage key="/vaults/b" {...props} vaultTidy={TIDY} />);
    expect(screen.getByRole('region', { name: 'Tidy the vault' })).toBeDefined();
    expect(rowStayedAt(before)).toBe(true);
    expect(screen.queryByRole('button', { name: /New above/ })).toBeNull();
  });
});

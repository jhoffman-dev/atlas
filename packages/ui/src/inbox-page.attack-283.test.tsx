// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createVaultPath, readProposal, type InboxItem } from '@atlas/domain';
import { InboxPage, type InboxContents, type InboxPageProps } from './inbox-page.tsx';

/**
 * Attack on #130 (PR #283): once the Inbox's rows are drawn, nothing new may
 * go in above them, or a click aimed at a row lands on something else. The
 * PR holds back the five offers; these are the other things drawn above the
 * rows that can still arrive after them.
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
  selection: { selected: new Set(), onToggle: vi.fn(), onToggleAll: vi.fn() },
  onClearSelection: vi.fn(),
  onAcceptMany: vi.fn(),
  onRejectMany: vi.fn(),
  onUndo: vi.fn(),
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

/** Whether `added` is absent, or drawn after the first row, so the row has not been pushed down. */
const notAboveFirstRow = (added: Element | null) =>
  added === null ||
  (firstRow().compareDocumentPosition(added) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe('InboxPage — what arrives after the rows are drawn does not go in above them (#130 attack)', () => {
  it('a proposals section read after the rows are drawn is not put above them', () => {
    // No offer is being read, so the rows are drawn at once; the proposals are not read yet.
    const rerender = page({ proposals: proposals(null) });
    expect(firstRow()).toBeDefined();

    rerender({
      proposals: proposals({
        open: [proposalNamed('Send the file')],
        stranded: [],
        unreadable: [],
      }),
    });
    expect(notAboveFirstRow(screen.queryByRole('region', { name: 'Proposals' }))).toBe(true);
  });

  it('the settings-note warning known after the rows are drawn is not put above them', () => {
    const rerender = page();
    expect(firstRow()).toBeDefined();

    rerender({
      settingsUnreadable: { problem: 'line 3: a list is not closed', onOpenSettings: vi.fn() },
    });
    const warning = screen.queryByText(/line 3: a list is not closed/);
    expect(notAboveFirstRow(warning)).toBe(true);
  });

  it('the owner-unknown warning known after the rows are drawn is not put above them', () => {
    const rerender = page();
    expect(firstRow()).toBeDefined();

    rerender({ ownerUnknown: { onOpenSettings: vi.fn() } });
    const warning = screen.queryByRole('alert', {
      name: 'Atlas can’t tell which action items are yours',
    });
    expect(notAboveFirstRow(warning)).toBe(true);
  });

  it('an offer read again from scratch after the rows are drawn, as on a vault switch, does not land above them', () => {
    // Vault A's tidy is shown and the rows are drawn below it.
    const rerender = page({ vaultTidy: TIDY });
    expect(screen.getByRole('region', { name: 'Tidy the vault' })).toBeDefined();
    // Another vault opens with the Inbox still open: its tidy starts reading from nothing…
    rerender({ vaultTidy: { ...TIDY, preview: null, reading: true } });
    // …and is known a moment later, after the rows of the new vault are on screen.
    rerender({ vaultTidy: TIDY });
    expect(notAboveFirstRow(screen.queryByRole('region', { name: 'Tidy the vault' }))).toBe(true);
  });
});

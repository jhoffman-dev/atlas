// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, readProposal, type ProposalNote, type VaultPath } from '@dfai/domain';
import type { RowSelection } from '../row-selection.tsx';
import { ProposalsSection, type ProposalsSectionProps } from './proposals-section.tsx';

/**
 * #307 (Q12): proposals that disagree are one "pick one" question. Accept
 * choice accepts the one picked and rejects the rest; Reject all rejects
 * every one. The filters show the sure ones or the questions, and "Accept
 * all high confidence" accepts exactly the sure ones that need no choice.
 */

const STANDUP = 'Inbox/Meetings/2026-10-16 Platform Standup.md';

function proposal(name: string, properties: Record<string, unknown>): ProposalNote {
  const reading = readProposal({
    path: createVaultPath(`Inbox/Proposals/${name}.md`),
    properties: { type: 'proposal', state: 'open', ...properties },
  });
  if (!reading.ok) throw new Error(reading.problem);
  return reading.proposal;
}

const mara = (name: string, link: string, confidence = 'low') =>
  proposal(name, {
    kind: 'link',
    confidence,
    source: '[[2026-10-16 Platform Standup#^t0002]]',
    payload: { note: STANDUP, property: 'people', link, digest: null },
  });

const task = (name: string, title: string, confidence: string | null) =>
  proposal(name, {
    kind: 'task',
    confidence,
    source: '[[2026-10-16 Platform Standup#^t0003]]',
    payload: { title, properties: { status: 'next-action' } },
  });

const MARA = mara('Mara 1', '[[Mara Quill]]');
const MARA_LARKSPUR = mara('Mara 2', '[[Mara Quill (Larkspur)]]');
const MARA_AGAIN = mara('Mara 3', '[[Mara Quill]]');
const SEND = task('Send', 'Send Mara the payroll file', 'high');
const CHASE = task('Chase', 'Chase the quote', 'low');
const CALL = task('Call', 'Call the bank', 'high');

const NONE_CHOSEN: RowSelection = { selected: new Set(), onToggle: vi.fn(), onToggleAll: vi.fn() };

function section(open: readonly ProposalNote[], more: Partial<ProposalsSectionProps> = {}) {
  const handlers = {
    onAccept: vi.fn<(path: VaultPath, payload?: unknown) => void>(),
    onReject: vi.fn<(path: VaultPath) => void>(),
    onAcceptChoice: vi.fn<(picked: VaultPath, rest: readonly VaultPath[]) => void>(),
    onClearSelection: vi.fn(),
    onAcceptMany: vi.fn<(paths: readonly VaultPath[]) => void>(),
    onRejectMany: vi.fn<(paths: readonly VaultPath[]) => void>(),
    onDismissNotice: vi.fn(),
    onOpen: vi.fn<(path: VaultPath) => void>(),
    onOpenSource: vi.fn<(link: string) => void>(),
  };
  render(
    <ProposalsSection
      contents={{ open, stranded: [], unreadable: [] }}
      error={null}
      notice={null}
      busy={null}
      problems={new Map()}
      selection={NONE_CHOSEN}
      {...handlers}
      {...more}
    />,
  );
  return handlers;
}

const QUESTION = 'Which link for people of 2026-10-16 Platform Standup?';
const question = () => screen.getByRole('region', { name: `Pick one: ${QUESTION}` });
const rowsShown = () =>
  within(screen.getByRole('list', { name: 'Open proposals' }))
    .getAllByRole('region')
    .map((region) => region.getAttribute('aria-label'));
const radio = (value: string) =>
  within(question())
    .getAllByRole('radio')
    .find((each) => (each as HTMLInputElement).value === value) as HTMLElement;

describe('ConflictGroupRow', () => {
  it('asks one question for the proposals that disagree, standing where the first of them was', () => {
    section([SEND, MARA, CHASE, MARA_LARKSPUR, MARA_AGAIN]);
    expect(rowsShown()).toEqual([
      'Task: Send Mara the payroll file',
      `Pick one: ${QUESTION}`,
      'Task: Chase the quote',
    ]);
    const asked = question();
    expect(
      within(asked).getByText('3 proposals disagree. Pick one; the others are rejected.'),
    ).toBeTruthy();
    expect(within(asked).getByText('Low').textContent).toBe('Low confidence');
    const radios = within(asked).getAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('value'))).toEqual([
      '[[Mara Quill]]',
      '[[Mara Quill (Larkspur)]]',
    ]);
    expect(within(asked).getByText('proposed 2 times')).toBeTruthy();
  });

  it('accepts nothing until one is picked', async () => {
    const handlers = section([MARA, MARA_LARKSPUR]);
    const accept = within(question()).getByRole('button', { name: 'Accept choice' });
    expect((accept as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(radio('[[Mara Quill (Larkspur)]]'));
    expect((accept as HTMLButtonElement).disabled).toBe(false);
    expect(handlers.onAcceptChoice).not.toHaveBeenCalled();
  });

  it('Accept choice accepts the one picked and rejects the rest, its duplicates among them', async () => {
    const handlers = section([MARA, MARA_LARKSPUR, MARA_AGAIN]);
    await userEvent.click(radio('[[Mara Quill (Larkspur)]]'));
    await userEvent.click(within(question()).getByRole('button', { name: 'Accept choice' }));
    expect(handlers.onAcceptChoice).toHaveBeenCalledWith(MARA_LARKSPUR.path, [
      MARA.path,
      MARA_AGAIN.path,
    ]);
    // The rejects are the hook's to run after the accept: the row asks for no reject itself.
    expect(handlers.onRejectMany).not.toHaveBeenCalled();
  });

  it('accepts the first of a value proposed twice, and rejects its twin', async () => {
    const handlers = section([MARA, MARA_LARKSPUR, MARA_AGAIN]);
    await userEvent.click(radio('[[Mara Quill]]'));
    await userEvent.click(within(question()).getByRole('button', { name: 'Accept choice' }));
    expect(handlers.onAcceptChoice).toHaveBeenCalledWith(MARA.path, [
      MARA_AGAIN.path,
      MARA_LARKSPUR.path,
    ]);
  });

  it('Reject all rejects every proposal of the question', async () => {
    const handlers = section([SEND, MARA, MARA_LARKSPUR]);
    await userEvent.click(within(question()).getByRole('button', { name: 'Reject all' }));
    expect(handlers.onRejectMany).toHaveBeenCalledWith([MARA.path, MARA_LARKSPUR.path]);
    expect(handlers.onAcceptChoice).not.toHaveBeenCalled();
  });

  it('says why an answer to one of them was refused, on the question', () => {
    section([MARA, MARA_LARKSPUR], {
      problems: new Map([
        [MARA_LARKSPUR.path, 'The meeting already links [[Mara Quill (Larkspur)]].'],
      ]),
    });
    expect(within(question()).getByRole('alert').textContent).toBe(
      'The meeting already links [[Mara Quill (Larkspur)]].',
    );
  });

  it('holds its answers while an accept is being undone', () => {
    section([MARA, MARA_LARKSPUR], { busy: 'undo' });
    for (const name of ['Reject all', 'Accept choice']) {
      expect((within(question()).getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(
        true,
      );
    }
  });

  it('gives no box to a question: the chosen are the proposals on their own', async () => {
    const selection: RowSelection = {
      selected: new Set(),
      onToggle: vi.fn(),
      onToggleAll: vi.fn(),
    };
    section([SEND, MARA, MARA_LARKSPUR, CHASE], { selection });
    expect(within(question()).queryByRole('checkbox')).toBeNull();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    expect(selection.onToggleAll).toHaveBeenCalledWith({
      paths: [SEND.path, CHASE.path],
      select: true,
    });
  });
});

describe('ProposalsSection — the filters and the sure ones (#307)', () => {
  it('shows every proposal, then only the sure ones, then only the questions', async () => {
    section([SEND, MARA, CHASE, MARA_LARKSPUR, CALL]);
    expect(rowsShown()).toHaveLength(4);
    await userEvent.click(screen.getByRole('button', { name: 'High confidence' }));
    expect(rowsShown()).toEqual(['Task: Send Mara the payroll file', 'Task: Call the bank']);
    await userEvent.click(screen.getByRole('button', { name: 'Needs a choice' }));
    expect(rowsShown()).toEqual([`Pick one: ${QUESTION}`]);
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(rowsShown()).toHaveLength(4);
  });

  it('says so when the filter leaves nothing, and keeps the proposals counted', async () => {
    section([CHASE]);
    await userEvent.click(screen.getByRole('button', { name: 'Needs a choice' }));
    expect(screen.queryByRole('list', { name: 'Open proposals' })).toBeNull();
    expect(screen.getByText('None of these.')).toBeTruthy();
    expect(screen.getByText(/^1 open proposal/)).toBeTruthy();
  });

  it('“Accept all high confidence” accepts exactly the sure ones that need no choice', async () => {
    const handlers = section([
      CHASE,
      mara('Mara A', '[[Mara Quill]]', 'high'),
      SEND,
      mara('Mara B', '[[Mara Quill (Larkspur)]]', 'high'),
      CALL,
      task('Silent', 'Fix the gate', null),
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Accept all high confidence' }));
    expect(handlers.onAcceptMany).toHaveBeenCalledWith([SEND.path, CALL.path]);
  });

  it('offers “Accept all high confidence” only while a sure one waits', () => {
    section([CHASE, MARA, MARA_LARKSPUR]);
    expect(screen.queryByRole('button', { name: 'Accept all high confidence' })).toBeNull();
  });

  it('holds “Accept all high confidence” while an accept is being undone', () => {
    section([SEND], { busy: 'undo' });
    const all = screen.getByRole('button', { name: 'Accept all high confidence' });
    expect((all as HTMLButtonElement).disabled).toBe(true);
  });
});

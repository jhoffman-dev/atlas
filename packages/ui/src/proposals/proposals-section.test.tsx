// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, readProposal, type ProposalNote, type VaultPath } from '@atlas/domain';
import { ProposalsSection, type ProposalsSectionProps } from './proposals-section.tsx';

function proposal(name: string, properties: Record<string, unknown>): ProposalNote {
  const reading = readProposal({
    path: createVaultPath(`Inbox/Proposals/${name}.md`),
    properties: { type: 'proposal', ...properties },
  });
  if (!reading.ok) throw new Error(reading.problem);
  return reading.proposal;
}

const TASK = proposal('Send the file', {
  kind: 'task',
  confidence: 'high',
  source: '[[2026-10-01 Standup#^t0003]]',
  made_by: 'after-meeting · run 1',
  payload: {
    title: 'Send Mara the payroll file',
    properties: { status: 'next', people: ['[[Mara Quill]]', '[[Tobias Fenn]]'] },
    body: 'By Friday.',
  },
});

const LINK = proposal('Mara works at Larkspur', {
  kind: 'link',
  payload: {
    note: 'People/Mara Quill.md',
    property: 'company',
    link: '[[Larkspur Payroll]]',
    digest: 'd',
  },
});

function page(props: Partial<ProposalsSectionProps> = {}) {
  const handlers = {
    onAccept: vi.fn<(path: VaultPath, payload?: unknown) => void>(),
    onReject: vi.fn<(path: VaultPath) => void>(),
    onUndo: vi.fn(),
    onDismissNotice: vi.fn(),
    onOpen: vi.fn<(path: VaultPath) => void>(),
    onOpenSource: vi.fn<(link: string) => void>(),
  };
  render(
    <ProposalsSection
      contents={{ open: [TASK, LINK], stranded: [], unreadable: [] }}
      error={null}
      notice={null}
      busy={null}
      problems={new Map()}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

const card = (name: RegExp) => screen.getByRole('region', { name });

describe('ProposalsSection', () => {
  it('lists each open proposal with what it would write, the line it cites and its maker', () => {
    page();
    const task = card(/^Task: Send Mara the payroll file/);
    expect(within(task).getByText('high confidence')).toBeTruthy();
    expect(within(task).getByRole('button', { name: /2026-10-01 Standup#\^t0003/ })).toBeTruthy();
    expect(within(task).getByText('after-meeting · run 1')).toBeTruthy();
    expect(within(task).getByText('[[Mara Quill]], [[Tobias Fenn]]')).toBeTruthy();
    expect(within(card(/^Link: /)).getByText(/Adds \[\[Larkspur Payroll\]\] to/)).toBeTruthy();
    expect(screen.getByText(/^2 open proposals/)).toBeTruthy();
  });

  it('says a person proposed from a meeting joins it, and keeps that through an edit', async () => {
    const person = proposal('Mara Quill — Standup', {
      kind: 'person',
      source: '[[2026-10-06 Standup]]',
      payload: {
        title: 'Mara Quill',
        folder: 'People',
        properties: { email: 'mara@larkspur.example' },
        link_from: { note: 'Inbox/Meetings/2026-10-06 Standup.md', property: 'people' },
      },
    });
    const { onAccept } = page({ contents: { open: [person], stranded: [], unreadable: [] } });
    const shown = card(/^Person: Mara Quill/);
    expect(within(shown).getByText(/And adds it to/).textContent).toBe(
      'And adds it to people of 2026-10-06 Standup.',
    );
    await userEvent.click(within(shown).getByRole('button', { name: 'Edit' }));
    await userEvent.click(within(shown).getByRole('button', { name: 'Accept as edited' }));
    expect(onAccept.mock.calls[0]?.[1]).toMatchObject({
      link_from: { note: 'Inbox/Meetings/2026-10-06 Standup.md', property: 'people' },
    });
  });

  it('flags a proposal that cites no source', () => {
    page();
    expect(within(card(/^Link: /)).getByText('Cites no source')).toBeTruthy();
    expect(within(card(/^Task: /)).queryByText('Cites no source')).toBeNull();
  });

  it('accepts and rejects the proposal whose button was pressed', async () => {
    const handlers = page();
    await userEvent.click(within(card(/^Link: /)).getByRole('button', { name: 'Accept' }));
    await userEvent.click(within(card(/^Task: /)).getByRole('button', { name: 'Reject' }));
    expect(handlers.onAccept).toHaveBeenCalledWith(LINK.path, undefined);
    expect(handlers.onReject).toHaveBeenCalledWith(TASK.path);
  });

  it('opens the cited line, and the proposal itself', async () => {
    const handlers = page();
    const task = card(/^Task: /);
    await userEvent.click(within(task).getByRole('button', { name: /Standup#\^t0003/ }));
    await userEvent.click(within(task).getByRole('button', { name: 'Open proposal' }));
    expect(handlers.onOpenSource).toHaveBeenCalledWith('[[2026-10-01 Standup#^t0003]]');
    expect(handlers.onOpen).toHaveBeenCalledWith(TASK.path);
  });

  it('edits the payload before accepting, sending what was typed', async () => {
    const handlers = page();
    const task = card(/^Task: /);
    await userEvent.click(within(task).getByRole('button', { name: 'Edit' }));
    const title = within(task).getByRole('textbox', { name: 'Title' });
    await userEvent.clear(title);
    await userEvent.type(title, 'Send Mara the Q4 file');
    const status = within(task).getByRole('textbox', { name: 'status' });
    await userEvent.clear(status);
    await userEvent.type(status, 'doing');
    await userEvent.click(within(task).getByRole('button', { name: 'Accept as edited' }));

    expect(handlers.onAccept).toHaveBeenCalledWith(TASK.path, {
      title: 'Send Mara the Q4 file',
      folder: null,
      body: 'By Friday.',
      properties: { status: 'doing', people: ['[[Mara Quill]]', '[[Tobias Fenn]]'] },
    });
  });

  it('cancels an edit, accepting nothing and showing the payload again', async () => {
    const handlers = page();
    const task = card(/^Task: /);
    await userEvent.click(within(task).getByRole('button', { name: 'Edit' }));
    expect(within(task).getByRole('textbox', { name: 'Title' })).toBeTruthy();
    await userEvent.click(within(task).getByRole('button', { name: 'Cancel' }));
    expect(within(task).queryByRole('textbox', { name: 'Title' })).toBeNull();
    expect(within(task).getByRole('button', { name: 'Accept' })).toBeTruthy();
    expect(handlers.onAccept).not.toHaveBeenCalled();
  });

  it('edits only a link proposal’s link', async () => {
    const handlers = page();
    const link = card(/^Link: /);
    await userEvent.click(within(link).getByRole('button', { name: 'Edit' }));
    expect(within(link).getAllByRole('textbox')).toHaveLength(1);
    const field = within(link).getByRole('textbox', { name: 'Link' });
    await userEvent.clear(field);
    await userEvent.type(field, '[[[[Larkspur]]');
    await userEvent.click(within(link).getByRole('button', { name: 'Accept as edited' }));
    expect(handlers.onAccept).toHaveBeenCalledWith(
      LINK.path,
      expect.objectContaining({ link: '[[Larkspur]]', note: 'People/Mara Quill.md' }),
    );
  });

  it('says why an answer was refused, on that proposal', () => {
    page({ problems: new Map([[TASK.path, 'There is already a note at Send.md.']]) });
    expect(within(card(/^Task: /)).getByRole('alert').textContent).toBe(
      'There is already a note at Send.md.',
    );
    expect(within(card(/^Link: /)).queryByRole('alert')).toBeNull();
  });

  it('holds every answer while an accept is being undone', () => {
    page({ busy: 'undo' });
    for (const name of ['Accept', 'Edit', 'Reject']) {
      const buttons = screen.getAllByRole('button', { name });
      expect(buttons).toHaveLength(2);
      for (const button of buttons) expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('offers to open what an accept made, and to undo it', async () => {
    const handlers = page({
      notice: {
        text: 'Accepted: Send Mara the payroll file.',
        opens: {
          path: createVaultPath('Send Mara the payroll file.md'),
          title: 'Send Mara the payroll file',
        },
        undoable: true,
      },
    });
    const notice = screen.getByRole('status');
    await userEvent.click(
      within(notice).getByRole('button', { name: 'Open Send Mara the payroll file' }),
    );
    await userEvent.click(within(notice).getByRole('button', { name: 'Undo' }));
    expect(handlers.onOpen).toHaveBeenCalledWith('Send Mara the payroll file.md');
    expect(handlers.onUndo).toHaveBeenCalledOnce();
  });

  it('says when there is nothing to answer, and lists what cannot be read', () => {
    page({
      contents: {
        open: [],
        stranded: [],
        unreadable: [
          { path: createVaultPath('Inbox/Proposals/Odd.md'), problem: 'It has no kind.' },
        ],
      },
    });
    expect(screen.getByText(/Nothing to answer/)).toBeTruthy();
    const unreadable = screen.getByRole('region', { name: 'Proposals that cannot be read' });
    expect(within(unreadable).getByText('It has no kind.')).toBeTruthy();
  });

  it('lists answered proposals still in the Inbox, each a click from its note', async () => {
    const handlers = page({
      contents: { open: [], stranded: [{ ...TASK, state: 'rejected' }], unreadable: [] },
    });
    const stranded = screen.getByRole('region', { name: 'Answered, still in the Inbox' });
    expect(within(stranded).getByText('Rejected')).toBeTruthy();
    await userEvent.click(
      within(stranded).getByRole('button', { name: 'Send Mara the payroll file' }),
    );
    expect(handlers.onOpen).toHaveBeenCalledWith(TASK.path);
  });

  it('marks a low-confidence proposal as one to check, and says why it was proposed', () => {
    const unsure = proposal('Send the contract', {
      kind: 'task',
      confidence: 'low',
      source: '[[Vendor contract call#^t0004]]',
      payload: {
        title: 'Send the contract',
        properties: { status: 'waiting', waiting_on: 'Lena Hart' },
      },
    });
    const why = 'There is no Person note for Lena Hart yet, so waiting_on holds the name as text.';
    page({
      contents: {
        open: [unsure, TASK],
        reasons: new Map([[unsure.path, why]]),
        stranded: [],
        unreadable: [],
      },
    });

    const low = screen.getByRole('region', { name: 'Task: Send the contract' });
    expect(within(low).getByText('low confidence')).toBeTruthy();
    expect(low.classList.contains('proposal-card--low')).toBe(true);
    expect(within(low).getByText(why)).toBeTruthy();
    expect(within(low).getByText('Lena Hart')).toBeTruthy();
    // A sure one is not marked, and a proposal with no reason shows none.
    const sure = screen.getByRole('region', { name: 'Task: Send Mara the payroll file' });
    expect(sure.classList.contains('proposal-card--low')).toBe(false);
    expect(sure.querySelector('.proposal-card__why')).toBeNull();
    expect(low.querySelector('.proposal-card__why')).not.toBeNull();
  });

  it('lets the owner be set before accepting: an empty waiting_on is a field to fill in', async () => {
    const unowned = proposal('Go through the renewal', {
      kind: 'task',
      confidence: 'low',
      payload: { title: 'Go through the renewal', properties: { status: 'inbox', waiting_on: '' } },
    });
    const handlers = page({ contents: { open: [unowned], stranded: [], unreadable: [] } });
    const card = screen.getByRole('region', { name: 'Task: Go through the renewal' });

    await userEvent.click(within(card).getByRole('button', { name: 'Edit' }));
    await userEvent.clear(within(card).getByLabelText('status'));
    await userEvent.type(within(card).getByLabelText('status'), 'waiting');
    await userEvent.type(within(card).getByLabelText('waiting_on'), 'Lena Hart');
    await userEvent.click(within(card).getByRole('button', { name: 'Accept as edited' }));

    expect(handlers.onAccept).toHaveBeenCalledWith(
      unowned.path,
      expect.objectContaining({ properties: { status: 'waiting', waiting_on: 'Lena Hart' } }),
    );
  });

  it('says why the folder could not be read', () => {
    page({ error: 'The vault could not be read.' });
    expect(screen.getByRole('alert').textContent).toBe('The vault could not be read.');
  });
});

describe('ProposalsSection — the notice goes by itself (#165)', () => {
  afterEach(() => vi.useRealTimers());

  const ACCEPTED = {
    text: 'Accepted: Send Mara the payroll file.',
    opens: null,
    undoable: true,
  };

  it('dismisses the notice, and with it the undo, after 20 seconds', () => {
    vi.useFakeTimers();
    const handlers = page({ notice: ACCEPTED });
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();

    act(() => vi.advanceTimersByTime(19_900));
    expect(handlers.onDismissNotice).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(200));
    expect(handlers.onDismissNotice).toHaveBeenCalledTimes(1);
  });

  it('waits while the pointer is on it, then gives the full time again', () => {
    vi.useFakeTimers();
    const handlers = page({ notice: ACCEPTED });
    const notice = screen.getByRole('status');

    act(() => vi.advanceTimersByTime(15_000));
    fireEvent.pointerEnter(notice);
    act(() => vi.advanceTimersByTime(120_000));
    expect(handlers.onDismissNotice).not.toHaveBeenCalled();

    fireEvent.pointerLeave(notice);
    act(() => vi.advanceTimersByTime(19_900));
    expect(handlers.onDismissNotice).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(200));
    expect(handlers.onDismissNotice).toHaveBeenCalledTimes(1);
  });

  it('waits while the focus is on its Undo, as a keyboard reaches it', () => {
    vi.useFakeTimers();
    const handlers = page({ notice: ACCEPTED });
    act(() => screen.getByRole('button', { name: 'Undo' }).focus());

    act(() => vi.advanceTimersByTime(120_000));
    expect(handlers.onDismissNotice).not.toHaveBeenCalled();

    act(() => screen.getByRole('button', { name: 'Undo' }).blur());
    act(() => vi.advanceTimersByTime(20_100));
    expect(handlers.onDismissNotice).toHaveBeenCalledTimes(1);
  });
});

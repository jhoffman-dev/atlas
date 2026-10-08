// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, readProposal, type ProposalNote, type VaultPath } from '@atlas/domain';
import { ProposalsPage, type ProposalsPageProps } from './proposals-page.tsx';

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

function page(props: Partial<ProposalsPageProps> = {}) {
  const handlers = {
    onAccept: vi.fn<(path: VaultPath, payload?: unknown) => void>(),
    onReject: vi.fn<(path: VaultPath) => void>(),
    onUndo: vi.fn(),
    onOpen: vi.fn<(path: VaultPath) => void>(),
    onOpenSource: vi.fn<(link: string) => void>(),
  };
  render(
    <ProposalsPage
      contents={{ open: [TASK, LINK], unreadable: [] }}
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

describe('ProposalsPage', () => {
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

  it('holds every answer while one is being made', () => {
    page({ busy: TASK.path });
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
        unreadable: [
          { path: createVaultPath('Inbox/Proposals/Odd.md'), problem: 'It has no kind.' },
        ],
      },
    });
    expect(screen.getByText(/Nothing to answer/)).toBeTruthy();
    const unreadable = screen.getByRole('region', { name: 'Proposals that cannot be read' });
    expect(within(unreadable).getByText('It has no kind.')).toBeTruthy();
  });

  it('says why the folder could not be read', () => {
    page({ error: 'The vault could not be read.' });
    expect(screen.getByRole('alert').textContent).toBe('The vault could not be read.');
  });
});

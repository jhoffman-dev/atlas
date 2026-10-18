// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, readProposal, type InboxItem, type InboxTask } from '@atlas/domain';
import {
  INBOX_OFFERS_WAIT_MS,
  InboxPage,
  type InboxContents,
  type InboxPageProps,
} from './inbox-page.tsx';
import type { RelationChoice } from './properties-panel.tsx';

/** A captured task, as the Inbox reads one that says nothing yet but its status. */
const CAPTURED: InboxTask = {
  status: 'inbox',
  project: null,
  waitingOn: null,
  waitingOnNames: '',
  defer: null,
  due: null,
};

const item = (
  path: string,
  title: string,
  type: string | null,
  arrivedIn = '',
  more: Partial<InboxItem> = {},
): InboxItem => ({
  path: createVaultPath(path),
  title,
  type,
  arrivedIn,
  importOutcome: null,
  importError: null,
  task: type === 'task' ? CAPTURED : null,
  ...more,
});

function proposalNamed(title: string) {
  const reading = readProposal({
    path: createVaultPath(`Inbox/Proposals/${title}.md`),
    properties: { type: 'proposal', kind: 'task', payload: { title } },
  });
  if (!reading.ok) throw new Error(reading.problem);
  return reading.proposal;
}

const PROPOSALS: NonNullable<InboxPageProps['proposals']> = {
  contents: { open: [proposalNamed('Send Mara the file')], stranded: [], unreadable: [] },
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
};

const CONTENTS: InboxContents = {
  items: [
    item('Inbox/Call the bank.md', 'Call the bank', 'task'),
    item('Inbox/Meetings/Standup.md', 'Standup', 'meeting', 'Meetings'),
    item('Inbox/Idea.md', 'Idea', null),
  ],
  truncated: false,
  total: 3,
};

const FILING: readonly RelationChoice[] = [
  { path: 'Projects/Atlas.md', title: 'Atlas', type: 'project' },
  { path: 'Areas/Garden.md', title: 'Garden', type: 'area' },
];

const PEOPLE: readonly RelationChoice[] = [
  { path: 'People/Mara Quill.md', title: 'Mara Quill', type: 'person' },
  { path: 'People/Tobias Fenn.md', title: 'Tobias Fenn', type: 'person' },
];

function page(overrides: Partial<InboxPageProps> = {}) {
  const props: InboxPageProps = {
    contents: CONTENTS,
    error: null,
    filing: FILING,
    people: PEOPLE,
    onOpen: vi.fn(),
    onShowMore: vi.fn(),
    onClarify: vi.fn(async () => true),
    busy: false,
    problem: null,
    ...overrides,
  };
  const view = render(<InboxPage {...props} />);
  return {
    ...props,
    rerender: (next: Partial<InboxPageProps>) => view.rerender(<InboxPage {...props} {...next} />),
  };
}

const rowOf = (title: string) =>
  screen.getByRole('button', { name: title }).closest('tr') as HTMLElement;

describe('InboxPage', () => {
  it('lists every note waiting, of any type, saying where in the Inbox it arrived', () => {
    page();
    expect(within(rowOf('Call the bank')).getByText('Task')).toBeDefined();
    expect(within(rowOf('Standup')).getByText('Meeting · Meetings')).toBeDefined();
    expect(within(rowOf('Idea')).getByText('Note')).toBeDefined();
    expect(screen.getByText(/3 to process/)).toBeDefined();
  });

  it('opens a note from its name', async () => {
    const props = page();
    await userEvent.click(screen.getByRole('button', { name: 'Standup' }));
    expect(props.onOpen).toHaveBeenCalledWith('Inbox/Meetings/Standup.md');
  });

  it('offers the projects and the areas to file a note under, each under its own', () => {
    page();
    const picker = screen.getByRole('combobox', { name: 'File Idea under' });
    const groups = [...picker.querySelectorAll('optgroup')];
    expect(groups.map((group) => group.label)).toEqual(['Projects', 'Areas']);
    expect(
      within(picker)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['File under…', 'Atlas', 'Garden']);
  });

  it('files a note that is not a task into the project picked, at once', async () => {
    const props = page();
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'File Standup under' }),
      'Garden',
    );
    expect(props.onClarify).toHaveBeenCalledWith({
      path: 'Inbox/Meetings/Standup.md',
      clarification: { project: 'Areas/Garden.md' },
    });
  });

  it('files nothing while a note is being filed, or when there is nothing to file under', () => {
    page({ busy: true });
    expect(
      (screen.getByRole('combobox', { name: 'File Idea under' }) as HTMLSelectElement).disabled,
    ).toBe(true);
  });

  it('says there is no project or area yet rather than offering an empty list', () => {
    page({ filing: [] });
    const picker = screen.getByRole('combobox', { name: 'File Idea under' }) as HTMLSelectElement;
    expect(picker.disabled).toBe(true);
    expect(picker.options[0]?.textContent).toBe('No project or area yet');
  });

  it('says why the last undo could not be done', () => {
    page({ problem: 'It was changed since, so it was left as it is.' });
    expect(screen.getByRole('alert').textContent).toBe(
      'It was changed since, so it was left as it is.',
    );
  });

  it('says when nothing is waiting', () => {
    page({ contents: { items: [], truncated: false, total: 0 } });
    expect(screen.getByText(/Nothing is waiting/)).toBeDefined();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('offers to let the vault’s types link a project or an area, and does it when asked', async () => {
    const onAccept = vi.fn();
    const onDismiss = vi.fn();
    page({
      typesOffer: {
        lines: ['Task gains Project, linking project or area notes.'],
        onAccept,
        onDismiss,
      },
    });
    const offer = screen.getByRole('complementary', {
      name: 'Set your types up for the Inbox',
    });
    expect(offer.textContent).toContain('Task gains Project, linking project or area notes.');
    await userEvent.click(within(offer).getByRole('button', { name: 'Add to the types' }));
    expect(onAccept).toHaveBeenCalledOnce();
    await userEvent.click(within(offer).getByRole('button', { name: 'Not now' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('links to the vault’s own Inbox view when it has one', async () => {
    const onOpen = vi.fn();
    page({ view: { title: 'Inbox', onOpen } });
    await userEvent.click(screen.getByRole('button', { name: 'Open the Inbox view' }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('has no offer and no view link when there is neither', () => {
    page();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Open the/ })).toBeNull();
  });

  it('says on a meeting’s row that it waits for the import, or why it was not imported', () => {
    page({
      contents: {
        items: [
          item('Inbox/Meetings/New.md', 'New', 'meeting', 'Meetings', { importOutcome: 'pending' }),
          item('Inbox/Meetings/Broken.md', 'Broken', null, 'Meetings', {
            importOutcome: 'error',
            importError: 'title is required',
          }),
          item('Inbox/Meetings/Done.md', 'Done', 'meeting', 'Meetings', {
            importOutcome: 'imported',
          }),
        ],
        truncated: false,
        total: 3,
      },
    });
    expect(within(rowOf('New')).getByText('Waiting to be imported')).toBeDefined();
    expect(within(rowOf('Broken')).getByText('Not imported: title is required')).toBeDefined();
    expect(within(rowOf('Done')).queryByText(/import/i)).toBeNull();
  });

  it('answers proposals in a section of its own, counted beside what is to process', async () => {
    page({ proposals: PROPOSALS });
    const section = screen.getByRole('region', { name: 'Proposals' });
    expect(within(section).getByText(/1 open proposal/)).toBeDefined();
    expect(screen.getByText(/3 to process .* · 1 to answer/)).toBeDefined();
    await userEvent.click(within(section).getByRole('button', { name: 'Accept' }));
    expect(PROPOSALS.onAccept).toHaveBeenCalledWith(
      'Inbox/Proposals/Send Mara the file.md',
      undefined,
    );
    expect(screen.queryByRole('combobox', { name: /File Send Mara the file under/ })).toBeNull();
  });

  it('shows no Proposals section while none wait', () => {
    page({ proposals: { ...PROPOSALS, contents: { open: [], stranded: [], unreadable: [] } } });
    expect(screen.getByRole('table')).toBeDefined();
    expect(screen.queryByRole('region', { name: 'Proposals' })).toBeNull();
  });
});

/** #112: a task is clarified where it is, and Done writes the row in one save. */
describe('InboxPage — clarifying a task on its row', () => {
  const TASK = 'Inbox/Call the bank.md';
  const control = (name: string) => screen.getByRole('combobox', { name });
  const done = () => within(rowOf('Call the bank')).getByRole('button', { name: 'Done' });

  it('offers the eight statuses, with the task’s own picked', () => {
    page();
    const status = control('Status of Call the bank') as HTMLSelectElement;
    expect([...status.options].map((option) => option.textContent)).toEqual([
      'Inbox',
      'Backlog',
      'Next Action',
      'In Progress',
      'Waiting',
      'Someday',
      'Longterm',
      'Archive',
    ]);
    expect(status.value).toBe('inbox');
  });

  it('offers only the statuses the vault’s Task type declares, and the one the task holds', () => {
    page({ statuses: ['backlog', 'someday'] });
    const status = control('Status of Call the bank') as HTMLSelectElement;
    expect([...status.options].map((option) => option.textContent)).toEqual([
      'Inbox',
      'Backlog',
      'Someday',
    ]);
  });

  it('does not write a person picked while the row said Waiting once the status was changed again', async () => {
    const props = page();
    await userEvent.selectOptions(control('Status of Call the bank'), 'Waiting');
    await userEvent.selectOptions(control('Who Call the bank waits on'), 'Mara Quill');
    await userEvent.selectOptions(control('Status of Call the bank'), 'Next Action');
    expect(screen.queryByRole('combobox', { name: 'Who Call the bank waits on' })).toBeNull();
    await userEvent.click(done());
    expect(props.onClarify).toHaveBeenCalledWith({
      path: TASK,
      clarification: { status: 'next-action' },
    });
  });

  it('offers no status, wait or date on a note that is not a task', () => {
    page();
    expect(screen.queryByRole('combobox', { name: 'Status of Standup' })).toBeNull();
    expect(screen.queryByLabelText('Standup is due')).toBeNull();
  });

  it('writes nothing until Done, which has nothing to write until something is picked', async () => {
    const props = page();
    expect((done() as HTMLButtonElement).disabled).toBe(true);

    await userEvent.selectOptions(control('Status of Call the bank'), 'Next Action');
    await userEvent.selectOptions(control('File Call the bank under'), 'Atlas');

    expect(props.onClarify).not.toHaveBeenCalled();
    expect((done() as HTMLButtonElement).disabled).toBe(false);
  });

  it('writes the status and the project together on Done', async () => {
    const props = page();
    await userEvent.selectOptions(control('Status of Call the bank'), 'Next Action');
    await userEvent.selectOptions(control('File Call the bank under'), 'Atlas');
    await userEvent.click(done());

    expect(props.onClarify).toHaveBeenCalledTimes(1);
    expect(props.onClarify).toHaveBeenCalledWith({
      path: TASK,
      clarification: { status: 'next-action', project: 'Projects/Atlas.md' },
    });
  });

  it('asks who it waits on once Waiting is picked, and writes both in one clarification', async () => {
    const props = page();
    expect(screen.queryByRole('combobox', { name: 'Who Call the bank waits on' })).toBeNull();

    await userEvent.selectOptions(control('Status of Call the bank'), 'Waiting');
    const who = control('Who Call the bank waits on');
    expect(
      within(who)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Waiting on…', 'Mara Quill', 'Tobias Fenn']);
    await userEvent.selectOptions(who, 'Mara Quill');
    await userEvent.click(done());

    expect(props.onClarify).toHaveBeenCalledTimes(1);
    expect(props.onClarify).toHaveBeenCalledWith({
      path: TASK,
      clarification: { status: 'waiting', waitingOn: 'People/Mara Quill.md' },
    });
  });

  it('writes a status alone: a single action needs no project', async () => {
    const props = page();
    await userEvent.selectOptions(control('Status of Call the bank'), 'Someday');
    await userEvent.click(done());
    expect(props.onClarify).toHaveBeenCalledWith({
      path: TASK,
      clarification: { status: 'someday' },
    });
  });

  it('writes defer and due as days, and Return in a date is Done', async () => {
    const props = page();
    await userEvent.type(screen.getByLabelText('Defer Call the bank until'), '2026-10-20');
    await userEvent.type(screen.getByLabelText('Call the bank is due'), '2026-11-02{Enter}');
    expect(props.onClarify).toHaveBeenCalledWith({
      path: TASK,
      clarification: { defer: '2026-10-20', due: '2026-11-02' },
    });
  });

  it('shows what the task already says, and clears a date that is emptied', async () => {
    const held: InboxTask = {
      status: 'waiting',
      project: createVaultPath('Areas/Garden.md'),
      waitingOn: createVaultPath('People/Tobias Fenn.md'),
      waitingOnNames: 'Tobias Fenn',
      defer: null,
      due: '2026-11-02',
    };
    const props = page({
      contents: {
        items: [item('Tasks/Chase.md', 'Chase', 'task', '', { task: held })],
        truncated: false,
        total: 1,
      },
    });
    expect((control('Status of Chase') as HTMLSelectElement).value).toBe('waiting');
    expect((control('File Chase under') as HTMLSelectElement).value).toBe('Areas/Garden.md');
    expect((control('Who Chase waits on') as HTMLSelectElement).value).toBe(
      'People/Tobias Fenn.md',
    );

    await userEvent.clear(screen.getByLabelText('Chase is due'));
    await userEvent.click(within(rowOf('Chase')).getByRole('button', { name: 'Done' }));
    expect(props.onClarify).toHaveBeenCalledWith({
      path: 'Tasks/Chase.md',
      clarification: { due: null },
    });
  });

  it('shows a refusal on the row it was for, and keeps what was picked', async () => {
    const refusal = {
      path: createVaultPath(TASK),
      reason: 'That task has changed since: read it again.',
    };
    page({ onClarify: vi.fn(async () => false), refusals: [refusal] });
    const alert = within(rowOf('Call the bank')).getByRole('alert');
    expect(alert.textContent).toBe('That task has changed since: read it again.');
    expect(within(rowOf('Standup')).queryByRole('alert')).toBeNull();

    await userEvent.selectOptions(control('Status of Call the bank'), 'Waiting');
    await userEvent.click(done());
    expect((control('Status of Call the bank') as HTMLSelectElement).value).toBe('waiting');
  });

  it('says a refusal above the list once its row has left it', () => {
    page({
      refusals: [{ path: createVaultPath('Inbox/Gone.md'), reason: 'Gone: the disk is full' }],
    });
    expect(screen.getByRole('alert').textContent).toBe('Gone: the disk is full');
  });

  it('puts the focus on the next row once a row is done, and leaves it when refused', async () => {
    page();
    await userEvent.selectOptions(control('Status of Call the bank'), 'Backlog');
    await userEvent.click(done());
    expect(document.activeElement).toBe(rowOf('Standup'));
    expect(rowOf('Standup').className).toContain('inbox__row--focused');
  });

  it('leaves the focus where it is when the row was refused', async () => {
    page({ onClarify: vi.fn(async () => false) });
    await userEvent.selectOptions(control('Status of Call the bank'), 'Backlog');
    await userEvent.click(done());
    expect(document.activeElement).toBe(done());
  });

  it('reaches every control of a row with Tab, in the order it is read', async () => {
    page();
    screen.getByRole('button', { name: 'Call the bank' }).focus();
    const reached: (string | null)[] = [];
    for (let stop = 0; stop < 4; stop += 1) {
      await userEvent.tab();
      reached.push(document.activeElement?.getAttribute('aria-label') ?? null);
    }
    expect(reached).toEqual([
      'Status of Call the bank',
      'File Call the bank under',
      'Defer Call the bank until',
      'Call the bank is due',
    ]);
  });

  it('makes a plain note a task from its row, and offers that on no other', async () => {
    const props = page();
    expect(within(rowOf('Standup')).queryByRole('button', { name: 'Make task' })).toBeNull();
    await userEvent.click(within(rowOf('Idea')).getByRole('button', { name: 'Make task' }));
    expect(props.onClarify).toHaveBeenCalledWith({
      path: 'Inbox/Idea.md',
      clarification: { asTask: true },
    });
  });

  it('offers to take the last clarification back', async () => {
    const onUndo = vi.fn();
    page({ lastAction: { title: 'Call the bank' }, onUndo, onDismissLastAction: vi.fn() });
    const said = screen.getByRole('status');
    expect(said.textContent).toContain('Clarified “Call the bank”.');
    await userEvent.click(within(said).getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it('offers no undo when nothing was clarified', () => {
    page({ onUndo: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });
});

describe('InboxPage — the undo bar goes by itself (#165)', () => {
  afterEach(() => vi.useRealTimers());

  it('dismisses “Clarified …” and its Undo after 20 seconds', () => {
    vi.useFakeTimers();
    const onDismissLastAction = vi.fn();
    page({ lastAction: { title: 'Call the bank' }, onUndo: vi.fn(), onDismissLastAction });

    act(() => vi.advanceTimersByTime(19_900));
    expect(onDismissLastAction).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(200));
    expect(onDismissLastAction).toHaveBeenCalledTimes(1);
  });

  it('waits while the pointer is on it', () => {
    vi.useFakeTimers();
    const onDismissLastAction = vi.fn();
    page({ lastAction: { title: 'Call the bank' }, onUndo: vi.fn(), onDismissLastAction });
    const said = screen.getByRole('status');

    fireEvent.pointerEnter(said);
    act(() => vi.advanceTimersByTime(120_000));
    expect(onDismissLastAction).not.toHaveBeenCalled();
    fireEvent.pointerLeave(said);
    act(() => vi.advanceTimersByTime(20_100));
    expect(onDismissLastAction).toHaveBeenCalledTimes(1);
  });
});

describe('InboxPage — a second clarification of the same title (review)', () => {
  afterEach(() => vi.useRealTimers());

  it('gives it the full 20 seconds again', () => {
    vi.useFakeTimers();
    const onDismissLastAction = vi.fn();
    const view = page({
      lastAction: { title: 'Call the bank' },
      onUndo: vi.fn(),
      onDismissLastAction,
    });
    act(() => vi.advanceTimersByTime(15_000));
    view.rerender({ lastAction: { title: 'Call the bank' } });
    act(() => vi.advanceTimersByTime(15_000));
    expect(onDismissLastAction).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(5_100));
    expect(onDismissLastAction).toHaveBeenCalledTimes(1);
  });
});

describe('InboxPage — more waiting than one page (#167)', () => {
  const FULL: InboxContents = { ...CONTENTS, truncated: true, total: 734 };

  it('says how many wait in all, and how many are shown', () => {
    page({ contents: FULL, onShowMore: vi.fn() });
    expect(screen.getByText(/^734 to process/)).toBeTruthy();
    expect(screen.getByText('Showing the newest 3 of 734.')).toBeTruthy();
  });

  it('shows more when asked, so every note can be reached', async () => {
    const onShowMore = vi.fn();
    page({ contents: FULL, onShowMore });
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(onShowMore).toHaveBeenCalledOnce();
  });

  it('offers no more once everything is shown', () => {
    page({ contents: { ...CONTENTS, total: 3 }, onShowMore: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
    expect(screen.getByText(/^3 to process/)).toBeTruthy();
  });
});

describe('InboxPage: when Atlas can’t tell which action items are yours (#181)', () => {
  const notice = () =>
    screen.queryByRole('alert', { name: 'Atlas can’t tell which action items are yours' });

  it('says so, and opens Settings', async () => {
    const onOpenSettings = vi.fn();
    page({ ownerUnknown: { onOpenSettings } });

    expect(notice()?.textContent).toContain('meetings make no tasks for you');
    expect(notice()?.textContent).toContain('Settings → Profile');
    await userEvent.click(within(notice()!).getByRole('button', { name: 'Open Settings' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('says nothing once the owner can be told apart', () => {
    const { rerender } = page({ ownerUnknown: { onOpenSettings: vi.fn() } });
    expect(notice()).not.toBeNull();

    rerender({ ownerUnknown: null });
    expect(notice()).toBeNull();
  });
});

describe('InboxPage: while the vault’s settings note cannot be read (#226)', () => {
  const notice = () => screen.queryByRole('alert', { name: 'Meetings and automations are paused' });

  it('says meetings and automations are paused, why, that nothing is lost, and opens Settings', async () => {
    const onOpenSettings = vi.fn();
    page({ settingsUnreadable: { problem: 'line 3: a list is not closed', onOpenSettings } });

    expect(notice()?.textContent).toContain('.atlas/settings.md can’t be read');
    expect(notice()?.textContent).toContain('line 3: a list is not closed');
    expect(notice()?.textContent).toContain('meetings wait in their folder');
    expect(notice()?.textContent).toContain('resume once it reads');
    await userEvent.click(within(notice()!).getByRole('button', { name: 'Open Settings' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('says nothing once it reads', () => {
    const { rerender } = page({
      settingsUnreadable: { problem: 'line 3: a list is not closed', onOpenSettings: vi.fn() },
    });
    expect(notice()).not.toBeNull();

    rerender({ settingsUnreadable: null });
    expect(notice()).toBeNull();
  });
});

const VAULT_TIDY: NonNullable<InboxPageProps['vaultTidy']> = {
  preview: {
    moves: [{ from: 'Loose idea.md', to: 'Notes/2026/Loose idea.md' }],
    refused: [],
  },
  open: false,
  busy: false,
  result: null,
  problem: null,
  onOpen: vi.fn(),
  onApply: vi.fn(),
  onClose: vi.fn(),
  onDismiss: vi.fn(),
};
/** The tidy while the vault is still read for it: nothing known to offer yet. */
const READING = { ...VAULT_TIDY, preview: null, reading: true };

describe('InboxPage — an offer read late does not move the ones already shown (#227)', () => {
  const TYPES_OFFER: NonNullable<InboxPageProps['typesOffer']> = {
    lines: ['Task gains Project, linking project or area notes.'],
    onAccept: vi.fn(),
    onDismiss: vi.fn(),
  };
  const MEETING_PROJECTS: NonNullable<InboxPageProps['meetingProjects']> = {
    rows: [
      {
        path: 'Meetings/2026-10-06 Larkspur standup.md',
        meeting: '2026-10-06 Larkspur standup',
        project: 'Ledger',
        confidence: 'high',
        reason:
          'Same series as 2026-10-05 Larkspur standup: 3 of its last 3 were filed under Ledger.',
        chosen: true,
      },
    ],
    open: false,
    busy: false,
    result: null,
    problem: null,
    canUndo: false,
    onOpen: vi.fn(),
    onToggle: vi.fn(),
    onRun: vi.fn(),
    onClose: vi.fn(),
    onUndo: vi.fn(),
    onDismiss: vi.fn(),
  };
  const typesOffer = () => screen.getByRole('complementary', { name: /Set your types up/ });
  const meetingOffer = () => screen.getByRole('region', { name: 'File meetings under projects' });
  const precedes = (first: HTMLElement, second: HTMLElement) =>
    (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  it('puts an offer read after another below it, so what is under the pointer stays put', () => {
    // While another is still read, so the rows are not drawn yet (#130).
    const view = page({ meetingProjects: MEETING_PROJECTS, vaultTidy: READING });
    view.rerender({
      meetingProjects: MEETING_PROJECTS,
      vaultTidy: READING,
      typesOffer: TYPES_OFFER,
    });
    expect(precedes(meetingOffer(), typesOffer())).toBe(true);
  });

  it('keeps the usual order for the offers read together', () => {
    page({ meetingProjects: MEETING_PROJECTS, typesOffer: TYPES_OFFER });
    expect(precedes(typesOffer(), meetingOffer())).toBe(true);
  });
});

describe('InboxPage — nothing moves under the pointer once the rows are drawn (#130)', () => {
  const TYPES_OFFER: NonNullable<InboxPageProps['typesOffer']> = {
    lines: ['Task gains Project, linking project or area notes.'],
    onAccept: vi.fn(),
    onDismiss: vi.fn(),
  };
  const tidyOffer = () => screen.queryByRole('region', { name: 'Tidy the vault' });
  const firstRow = () => screen.queryByRole('button', { name: 'Call the bank' });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds the rows back while an offer is still being read, then draws them below it', () => {
    const view = page({ vaultTidy: READING, proposals: PROPOSALS });
    expect(firstRow()).toBeNull();
    expect(screen.queryByRole('region', { name: 'Proposals' })).toBeNull();
    // Drawn in place, so showing them costs nothing, but out of reach until then.
    const held = screen.getByText('Call the bank');
    expect(held.closest('[inert]')).not.toBeNull();

    view.rerender({ vaultTidy: VAULT_TIDY, proposals: PROPOSALS });
    const offer = tidyOffer();
    const row = firstRow();
    expect(offer).not.toBeNull();
    expect(row).not.toBeNull();
    expect((offer!.compareDocumentPosition(row!) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(
      true,
    );
  });

  // Late now means shown at once: the rows are held still on screen as it lands (list-anchor.test.tsx).
  it('draws the rows anyway once a slow read has had its time, and shows that offer when it comes', () => {
    vi.useFakeTimers();
    const view = page({ vaultTidy: READING });
    expect(firstRow()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(INBOX_OFFERS_WAIT_MS);
    });
    expect(firstRow()).not.toBeNull();

    view.rerender({ vaultTidy: VAULT_TIDY });
    expect(tidyOffer()).not.toBeNull();
    expect(firstRow()).not.toBeNull();
  });

  it('shows an offer that arrives after the rows are drawn, without waiting for the next open', () => {
    const view = page();
    expect(firstRow()).not.toBeNull();
    view.rerender({ typesOffer: TYPES_OFFER });
    expect(screen.queryByRole('complementary', { name: /Set your types up/ })).not.toBeNull();
    expect(firstRow()).not.toBeNull();
  });

  it('still changes an offer already shown, as the person answers it', () => {
    const view = page({ vaultTidy: VAULT_TIDY });
    expect(tidyOffer()).not.toBeNull();
    view.rerender({ vaultTidy: { ...VAULT_TIDY, preview: null, result: 'Tidied the vault.' } });
    expect(within(tidyOffer()!).getByRole('status').textContent).toBe('Tidied the vault.');
  });

  it('keeps showing an offer already shown that is briefly read as nothing, as a run settles', () => {
    const view = page({ vaultTidy: VAULT_TIDY });
    expect(tidyOffer()).not.toBeNull();
    // Read again mid-run: the moves are made, and the run has not said so yet.
    view.rerender({ vaultTidy: null });
    view.rerender({ vaultTidy: { ...VAULT_TIDY, preview: null, result: 'Tidied the vault.' } });
    expect(within(tidyOffer()!).getByRole('status').textContent).toBe('Tidied the vault.');
  });
});

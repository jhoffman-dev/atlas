// @vitest-environment jsdom
/** Attack on PR #406 (#307): one-key triage on the Inbox's rows, tried against what the author did not think of. */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, type InboxItem, type InboxTask } from '@atlas/domain';
import { InboxPage, type InboxPageProps } from '../inbox-page.tsx';
import { startCountingRenders, stopCountingRenders } from '../testing/render-counter.ts';

// Before React loads, so every commit is handed to the counter.
await vi.hoisted(async () => {
  const { installRenderCounter } = await import('../testing/render-counter.ts');
  installRenderCounter();
});

const CAPTURED: InboxTask = {
  status: 'inbox',
  project: null,
  waitingOn: null,
  waitingOnNames: '',
  defer: null,
  due: null,
};

const TITLES = ['Call the bank', 'Chase the quote', 'Learn the cello', 'Renew the passport'];
const task = (title: string, more: Partial<InboxTask> = {}): InboxItem => ({
  path: createVaultPath(`Inbox/${title}.md`),
  title,
  type: 'task',
  arrivedIn: '',
  importOutcome: null,
  importError: null,
  task: { ...CAPTURED, ...more },
});
const TASKS = TITLES.map((title) => task(title));
const FILING = [{ path: 'Projects/Atlas.md', title: 'Atlas', type: 'project' }];

function page(overrides: Partial<InboxPageProps> = {}) {
  const props: InboxPageProps = {
    contents: { items: TASKS, truncated: false, total: TASKS.length },
    error: null,
    filing: FILING,
    people: [],
    onOpen: vi.fn(),
    onShowMore: vi.fn(),
    onClarify: vi.fn(async () => true),
    busy: false,
    problem: null,
    ...overrides,
  } as InboxPageProps;
  const view = render(<InboxPage {...props} />);
  return { ...props, view, props };
}

const rowOf = (title: string) =>
  screen.getByRole('button', { name: title }).closest('tr') as HTMLElement;
const focusRow = (title: string) => act(() => rowOf(title).focus());
const calls = (onClarify: InboxPageProps['onClarify']) =>
  (onClarify as ReturnType<typeof vi.fn>).mock.calls.map(([args]) => args);

describe('one-key triage — a held key (attack #406)', () => {
  it('acts once for a key held down: the auto-repeat does not triage the rows after it', async () => {
    const { onClarify } = page();
    focusRow('Call the bank');
    fireEvent.keyDown(rowOf('Call the bank'), { key: 'd' });
    await act(async () => {});
    // The focus has moved on; the key is still down and the OS repeats it.
    expect(document.activeElement).toBe(rowOf('Chase the quote'));
    fireEvent.keyDown(document.activeElement!, { key: 'd', repeat: true });
    await act(async () => {});
    fireEvent.keyDown(document.activeElement!, { key: 'd', repeat: true });
    await act(async () => {});
    expect(calls(onClarify)).toEqual([
      { path: 'Inbox/Call the bank.md', clarification: { status: 'archive' } },
    ]);
  });
});

describe('one-key triage — while the Inbox is busy (attack #406)', () => {
  it('does nothing for a key while the row’s own controls are disabled (an undo being written)', async () => {
    const { onClarify } = page({ busy: true });
    focusRow('Call the bank');
    const next = within(rowOf('Call the bank')).getByRole('button', { name: 'Next, key N' });
    // The key's own button is disabled while busy ...
    expect((next as HTMLButtonElement).disabled).toBe(true);
    // ... so the key must be too.
    fireEvent.keyDown(rowOf('Call the bank'), { key: 'n' });
    await act(async () => {});
    expect(onClarify).not.toHaveBeenCalled();
  });
});

describe('one-key triage — the armed picker (attack #406)', () => {
  it('disarms the picker P opened when Escape leaves it: a later pick waits for Done', async () => {
    const { onClarify } = page();
    focusRow('Call the bank');
    await userEvent.keyboard('p');
    const picker = screen.getByRole('combobox', { name: 'File Call the bank under' });
    expect(document.activeElement).toBe(picker);
    // Escape: "not this". The picker keeps the focus, as a native select does.
    await userEvent.keyboard('{Escape}');
    fireEvent.change(picker, { target: { value: 'Projects/Atlas.md' } });
    expect(onClarify).not.toHaveBeenCalled();
  });

  it('writes nothing at once when the defer date T opened is cleared rather than picked', async () => {
    const items = [task('Call the bank', { defer: '2026-11-02' }), ...TASKS.slice(1)];
    const { onClarify } = page({ contents: { items, truncated: false, total: items.length } });
    focusRow('Call the bank');
    await userEvent.keyboard('t');
    const defer = screen.getByLabelText('Defer Call the bank until');
    // Backspace in a date segment empties the field: a keystroke on the way to a date, not a pick.
    fireEvent.change(defer, { target: { value: '' } });
    expect(onClarify).not.toHaveBeenCalled();
  });

  it('offers P only when it can do something: no project or area to file under, no live P', () => {
    page({ filing: [] });
    focusRow('Call the bank');
    const p = within(rowOf('Call the bank')).queryByRole('button', { name: 'Project, key P' });
    expect(p === null || (p as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('one-key triage — guards that hold (attack #406)', () => {
  it('acts on the row when the key is pressed on a button inside it (not a field)', async () => {
    const { onClarify } = page();
    focusRow('Learn the cello');
    const done = within(rowOf('Learn the cello')).getByRole('button', { name: 'Save' });
    act(() => done.focus());
    await userEvent.keyboard('s');
    expect(calls(onClarify)).toEqual([
      { path: 'Inbox/Learn the cello.md', clarification: { status: 'someday' } },
    ]);
  });

  it('does nothing for a status key on a note that is not a task', async () => {
    const note: InboxItem = { ...task('Idea'), type: null, task: null };
    const { onClarify } = page({ contents: { items: [note], truncated: false, total: 1 } });
    focusRow('Idea');
    await userEvent.keyboard('n');
    await userEvent.keyboard('d');
    await userEvent.keyboard('t');
    expect(onClarify).not.toHaveBeenCalled();
  });

  it('leaves the focus on the last row when the key acts on it, and on it alone', async () => {
    const { onClarify } = page();
    focusRow('Renew the passport');
    await userEvent.keyboard('w');
    expect(calls(onClarify)).toEqual([
      { path: 'Inbox/Renew the passport.md', clarification: { status: 'waiting' } },
    ]);
    expect(document.activeElement).toBe(rowOf('Learn the cello'));
  });

  it('keeps the row and the focus when the write is refused', async () => {
    const { onClarify } = page({ onClarify: vi.fn(async () => false) });
    focusRow('Call the bank');
    await userEvent.keyboard('n');
    expect(onClarify).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(rowOf('Call the bank'));
  });

  it('draws no InboxRow again as keys move the focus down the list and arm a picker', async () => {
    const { view, props } = page();
    focusRow('Call the bank');
    startCountingRenders();
    await userEvent.keyboard('{ArrowDown}');
    act(() => rowOf('Chase the quote').focus());
    act(() => rowOf('Learn the cello').focus());
    await userEvent.keyboard('p');
    act(() => rowOf('Renew the passport').focus());
    view.rerender(<InboxPage {...props} />);
    const { renders } = stopCountingRenders();
    // The counter is live: the list itself was drawn as the focus moved.
    expect(renders['InboxRows'] ?? 0).toBeGreaterThan(0);
    expect(renders['InboxRow'] ?? 0).toBe(0);
  });

  it('draws no InboxRow again when a key writes and the focus moves on', async () => {
    const { view, props } = page();
    focusRow('Call the bank');
    startCountingRenders();
    await userEvent.keyboard('n');
    view.rerender(<InboxPage {...props} />);
    const { renders } = stopCountingRenders();
    expect(document.activeElement).toBe(rowOf('Chase the quote'));
    expect(renders['InboxRows'] ?? 0).toBeGreaterThan(0);
    expect(renders['InboxRow'] ?? 0).toBe(0);
  });
});

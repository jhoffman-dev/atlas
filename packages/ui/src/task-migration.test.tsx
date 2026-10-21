// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GTD_STATUSES } from '@dfai/domain';
import { TaskMigration, type TaskMigrationProps } from './task-migration.tsx';

/** P30-02: the move to GTD is offered in a line, previewed in full, and run only when asked. */
const PREVIEW: TaskMigrationProps['preview'] = {
  mapping: [
    { from: 'doing', to: 'in-progress', tasks: 1 },
    { from: 'done', to: 'archive', tasks: 1 },
    { from: '', to: 'inbox', tasks: 1 },
  ],
  statuses: GTD_STATUSES,
  typeLines: ['Status becomes Inbox, … and Archive.', 'Task gains Waiting on.'],
  tasks: [
    {
      path: 'tasks/Draft.md',
      title: 'Draft the memo',
      from: 'doing',
      to: 'in-progress',
      completed: null,
    },
    {
      path: 'tasks/Ship.md',
      title: 'Ship it',
      from: 'done',
      to: 'archive',
      completed: '2026-09-30',
    },
    {
      path: 'tasks/Hear.md',
      title: 'Hear back',
      from: 'Waiting',
      to: 'waiting',
      completed: null,
    },
    { path: 'tasks/Odd.md', title: 'Odd one', from: '', to: 'inbox', completed: null },
  ],
  references: [{ title: 'Roadmap', moved: ['done → archive'] }],
  listed: [{ title: 'Odd view', reason: 'It compares status using contains.' }],
  views: ['Next actions', 'Waiting'],
};

function panel(overrides: Partial<TaskMigrationProps> = {}) {
  const props: TaskMigrationProps = {
    preview: PREVIEW,
    open: false,
    busy: false,
    result: null,
    problem: null,
    canUndo: false,
    onOpen: vi.fn(),
    onChoose: vi.fn(),
    onRun: vi.fn(),
    onClose: vi.fn(),
    onUndo: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  const view = render(<TaskMigration {...props} />);
  return { props, ...view };
}

describe('TaskMigration', () => {
  it('offers the move in one line, writing nothing until the preview is asked for', async () => {
    const { props } = panel();
    expect(screen.getByText(/4 tasks would move to them/)).toBeDefined();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Move/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Preview the move' }));
    expect(props.onOpen).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('previews every task old → new, with the day a finished one is given', () => {
    panel({ open: true });
    const rows = within(screen.getByRole('table', { name: 'Tasks that move' })).getAllByRole('row');
    expect(rows.slice(1).map((row) => row.textContent)).toEqual([
      'Draft the memoDoingIn Progress',
      'Ship itDoneArchive, completed 2026-09-30',
      'Hear backWaitingWaiting',
      'Odd one(none)Inbox',
    ]);
  });

  it('says what else changes, and lists what it cannot rewrite', () => {
    panel({ open: true });
    expect(screen.getByRole('list', { name: 'The Task type' }).textContent).toContain(
      'Task gains Waiting on.',
    );
    expect(screen.getByRole('list', { name: 'Views and automations rewritten' }).textContent).toBe(
      'Roadmap: done → archive',
    );
    expect(
      screen.getByRole('list', { name: 'Listed for you to change by hand' }).textContent,
    ).toContain('Odd view');
    expect(screen.getByRole('list', { name: 'Views added' }).textContent).toBe(
      'Next actionsWaiting',
    );
  });

  it('lets each old status be sent elsewhere before running', async () => {
    const { props } = panel({ open: true });
    const doing = screen.getByRole('combobox', { name: 'Doing becomes' });
    expect((doing as HTMLSelectElement).value).toBe('in-progress');
    expect(
      within(doing)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'Inbox',
      'Backlog',
      'Next Action',
      'In Progress',
      'Waiting',
      'Someday',
      'Longterm',
      'Archive',
    ]);
    await userEvent.selectOptions(doing, 'next-action');
    expect(props.onChoose).toHaveBeenCalledWith({ from: 'doing', to: 'next-action' });
  });

  it('runs only from the preview, once, and not while busy', async () => {
    const { props, rerender } = panel({ open: true });
    await userEvent.click(screen.getByRole('button', { name: 'Move 4 tasks' }));
    expect(props.onRun).toHaveBeenCalledTimes(1);
    rerender(<TaskMigration {...props} busy />);
    expect(
      (screen.getByRole('button', { name: 'Move 4 tasks' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('says what the run did, and offers to undo it', async () => {
    const { props } = panel({
      preview: null,
      result: 'Moved tasks to GTD statuses.',
      canUndo: true,
    });
    expect(screen.getByRole('status').textContent).toBe('Moved tasks to GTD statuses.');
    await userEvent.click(screen.getByRole('button', { name: 'Undo the move to GTD' }));
    expect(props.onUndo).toHaveBeenCalled();
  });

  it('lets the undo offer be dismissed, so it ends rather than waiting for the week to pass (#163)', async () => {
    const { props } = panel({ preview: null, result: null, canUndo: true });
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
    expect(props.onUndo).not.toHaveBeenCalled();
  });

  it('draws nothing when there is nothing to move and nothing to undo', () => {
    const { container } = panel({ preview: null });
    expect(container.textContent).toBe('');
  });
});

/** #319: the offer is the one-line notice bar, its verbs at the end, grown open for the preview. */
describe('TaskMigration as the notice bar (#319)', () => {
  const region = () => screen.getByRole('region', { name: 'Move tasks to GTD statuses' });
  const classes = (element: Element) => [...element.classList];

  it('is the bar, with Preview the move as the secondary verb and Not now as the ghost one', () => {
    panel();
    expect(classes(region())).toEqual(
      expect.arrayContaining(['notice-bar', 'inbox__offer', 'task-migration']),
    );
    expect(classes(region())).not.toContain('notice-bar--open');
    const [first, second] = screen.getAllByRole('button');
    expect(first?.textContent).toBe('Preview the move');
    expect(classes(first!)).toEqual(expect.arrayContaining(['btn', 'btn--secondary', 'btn--sm']));
    expect(second?.textContent).toBe('Not now');
    expect(classes(second!)).toEqual(expect.arrayContaining(['btn', 'btn--ghost', 'btn--sm']));
  });

  it('carries --open while the preview shows under the line, whose run button is secondary too (one primary per view)', () => {
    panel({ open: true });
    expect(classes(region())).toContain('notice-bar--open');
    const run = screen.getByRole('button', { name: 'Move 4 tasks' });
    expect(classes(run)).toContain('btn--secondary');
    expect(classes(run)).not.toContain('btn--primary');
  });
});

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MeetingCleanup, type MeetingCleanupProps } from './meeting-cleanup.tsx';

/** #226: the tasks meetings made that today's rules would not have, offered to archive. */

const TASKS = [
  {
    path: 'Tasks/Flag the new cache.md',
    title: 'Flag the new cache',
    why: 'Someone else said it, not you.',
  },
  {
    path: 'Tasks/Book the room.md',
    title: 'Book the room',
    why: 'Nobody named said it, so it may not be yours.',
  },
];

const propsOf = (overrides: Partial<MeetingCleanupProps> = {}): MeetingCleanupProps => ({
  tasks: TASKS,
  kept: new Set(),
  open: false,
  busy: false,
  result: null,
  problem: null,
  onOpen: vi.fn(),
  onToggle: vi.fn(),
  onApply: vi.fn(),
  onClose: vi.fn(),
  onDismiss: vi.fn(),
  onOpenTask: vi.fn(),
  ...overrides,
});

function draw(overrides: Partial<MeetingCleanupProps> = {}) {
  const props = propsOf(overrides);
  render(<MeetingCleanup {...props} />);
  return props;
}

const region = () => screen.getByRole('region', { name: 'Tasks meetings made' });

describe('MeetingCleanup', () => {
  it('offers in one line, and opens the preview or puts it away', async () => {
    const props = draw();
    expect(region().textContent).toContain(
      '2 tasks that meetings made aren’t yours by today’s rules',
    );

    await userEvent.click(within(region()).getByRole('button', { name: 'Review them' }));
    await userEvent.click(within(region()).getByRole('button', { name: 'Not now' }));
    expect(props.onOpen).toHaveBeenCalledTimes(1);
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
  });

  it('lists every task with why, each ticked to go, and archives them on Archive', async () => {
    const props = draw({ open: true });
    const table = within(region()).getByRole('table', { name: 'Tasks to archive' });

    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(table.textContent).toContain('Someone else said it, not you.');
    expect(within(table).getByRole('checkbox', { name: 'Archive Book the room' })).toHaveProperty(
      'checked',
      true,
    );
    await userEvent.click(within(region()).getByRole('button', { name: 'Archive 2 tasks' }));
    expect(props.onApply).toHaveBeenCalledTimes(1);
  });

  it('keeps a task unticked, and counts only what goes', async () => {
    const props = draw({ open: true, kept: new Set(['Tasks/Book the room.md']) });

    expect(screen.getByRole('checkbox', { name: 'Archive Book the room' })).toHaveProperty(
      'checked',
      false,
    );
    expect(within(region()).getByRole('button', { name: 'Archive 1 task' })).toBeDefined();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Archive Flag the new cache' }));
    expect(props.onToggle).toHaveBeenCalledWith('Tasks/Flag the new cache.md');
  });

  it('archives nothing when every task is kept', () => {
    draw({ open: true, kept: new Set(TASKS.map(({ path }) => path)) });
    expect(within(region()).getByRole('button', { name: 'Archive 0 tasks' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('opens a task from its title', async () => {
    const props = draw({ open: true });
    await userEvent.click(screen.getByRole('button', { name: 'Flag the new cache' }));
    expect(props.onOpenTask).toHaveBeenCalledWith('Tasks/Flag the new cache.md');
  });

  it('says what it did, or why it could not, and nothing when there is nothing', async () => {
    const props = draw({
      tasks: null,
      result: 'Archived 2 tasks meetings made that weren’t yours.',
    });
    expect(within(region()).getByRole('status').textContent).toBe(
      'Archived 2 tasks meetings made that weren’t yours.',
    );
    await userEvent.click(within(region()).getByRole('button', { name: 'Dismiss' }));
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
  });

  it('says why the cleanup could not be done', () => {
    draw({ tasks: null, problem: 'The cleanup stopped: the disk is full' });
    expect(within(region()).getByRole('alert').textContent).toBe(
      'The cleanup stopped: the disk is full',
    );
  });

  it('draws nothing with nothing to offer or say', () => {
    const { container } = render(<MeetingCleanup {...propsOf({ tasks: null })} />);
    expect(container.innerHTML).toBe('');
  });
});

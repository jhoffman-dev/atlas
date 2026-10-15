// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MeetingProjects, type MeetingProjectsProps } from './meeting-projects.tsx';

const ROWS = [
  {
    path: 'Meetings/2026-10-14 Standup.md',
    meeting: '2026-10-14 Larkspur Standup',
    project: 'Ledger',
    confidence: 'high',
    reason: 'Same series as 2026-10-13 Larkspur Standup: 6 of its last 6 were filed under Ledger.',
    chosen: true,
  },
  {
    path: 'Meetings/2026-10-13 Review.md',
    meeting: '2026-10-13 Review',
    project: 'Payrun',
    confidence: 'medium',
    reason: 'Same series as 2026-10-06 Review, which is filed under Payrun.',
    chosen: false,
  },
  {
    path: 'Meetings/2026-10-12 Coffee.md',
    meeting: '2026-10-12 Coffee',
    project: null,
    confidence: null,
    reason: 'Nothing in its series, or another copy of it, says which project.',
    chosen: false,
  },
];

function props(overrides: Partial<MeetingProjectsProps> = {}): MeetingProjectsProps {
  return {
    rows: ROWS,
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
    ...overrides,
  };
}

describe('MeetingProjects (#227)', () => {
  it('offers to file the meetings with no project in one line, and files nothing from there', async () => {
    const given = props();
    render(<MeetingProjects {...given} />);
    expect(screen.getByText(/3 meetings have no project\. 2 can be filed/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^File/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(given.onOpen).toHaveBeenCalledOnce();
    expect(given.onRun).not.toHaveBeenCalled();
  });

  it('previews each suggestion, ticked when sure, and lists those left empty with why', async () => {
    const given = props({ open: true });
    render(<MeetingProjects {...given} />);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.map((box) => (box as HTMLInputElement).checked)).toEqual([true, false]);
    expect(screen.getByText('6 of its last 6', { exact: false })).toBeTruthy();
    const empty = screen.getByRole('list', { name: 'Left empty' });
    expect(empty.textContent).toBe(
      '2026-10-12 Coffee: Nothing in its series, or another copy of it, says which project.',
    );

    await userEvent.click(boxes[1]!);
    expect(given.onToggle).toHaveBeenCalledWith('Meetings/2026-10-13 Review.md');
    await userEvent.click(screen.getByRole('button', { name: 'File 1 meeting' }));
    expect(given.onRun).toHaveBeenCalledOnce();
  });

  it('cannot file when nothing is ticked', () => {
    const rows = ROWS.map((row) => ({ ...row, chosen: false }));
    render(<MeetingProjects {...props({ open: true, rows })} />);
    expect(
      (screen.getByRole('button', { name: 'File 0 meetings' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('offers to undo the last run until dismissed', async () => {
    const given = props({
      rows: null,
      result: 'Filed 2 meetings under their projects.',
      canUndo: true,
    });
    render(<MeetingProjects {...given} />);
    expect(screen.getByRole('status').textContent).toBe('Filed 2 meetings under their projects.');
    await userEvent.click(screen.getByRole('button', { name: 'Undo filing' }));
    expect(given.onUndo).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(given.onDismiss).toHaveBeenCalledOnce();
  });

  it('shows nothing when there is nothing to file and nothing to say', () => {
    const { container } = render(<MeetingProjects {...props({ rows: null })} />);
    expect(container.innerHTML).toBe('');
  });
});

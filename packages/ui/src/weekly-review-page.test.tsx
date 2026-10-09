// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, type ReviewProject, type ReviewTask } from '@atlas/domain';
import type { WeeklyReviewReport } from '@atlas/application';
import { WeeklyReviewPage, type WeeklyReviewPageProps } from './weekly-review-page.tsx';

const task = (title: string, fields: Partial<ReviewTask> = {}): ReviewTask => ({
  path: createVaultPath(`Tasks/${title}.md`),
  title,
  status: 'next-action',
  due: null,
  defer: null,
  waitingOn: '',
  project: null,
  modified: 0,
  ...fields,
});

const GARDEN: ReviewProject = {
  path: createVaultPath('Projects/Garden.md'),
  title: 'Garden',
  status: 'active',
  moving: false,
};

const REVIEW: WeeklyReviewReport = {
  today: '2026-10-08',
  staleWaiting: [task('Quote from Larkspur', { status: 'waiting', waitingOn: 'Mara Quill' })],
  projectsWithoutNextAction: [GARDEN],
  overdue: [task('Ship the review', { due: '2026-10-05' })],
  untouchedSomeday: [task('Learn the cello', { status: 'someday' })],
  inbox: { count: 2, more: false },
  truncated: false,
};

function page(overrides: Partial<WeeklyReviewPageProps> = {}) {
  const props: WeeklyReviewPageProps = {
    review: REVIEW,
    error: null,
    projectStatuses: ['planned', 'active', 'paused', 'done'],
    busy: false,
    problem: null,
    onOpen: vi.fn(),
    onOpenInbox: vi.fn(),
    onSetStatus: vi.fn(),
    onSetProjectStatus: vi.fn(),
    onDefer: vi.fn(),
    onArchiveTask: vi.fn(),
    onArchiveProject: vi.fn(),
    ...overrides,
  };
  render(<WeeklyReviewPage {...props} />);
  return props;
}

const section = (name: string | RegExp) => screen.getByRole('region', { name });

describe('WeeklyReviewPage', () => {
  it('shows each section with its items, and says what each is about', () => {
    page();
    const waiting = section(/^Waiting for more than 7 days/);
    expect(within(waiting).getByRole('button', { name: 'Quote from Larkspur' })).toBeDefined();
    expect(within(waiting).getByText('On Mara Quill')).toBeDefined();
    const projects = section('Active projects with no next action');
    expect(within(projects).getByRole('button', { name: 'Garden' })).toBeDefined();
    expect(within(section('Overdue')).getByText('Due 2026-10-05')).toBeDefined();
    const someday = section(/^Someday and Longterm/);
    expect(within(someday).getByText('Someday')).toBeDefined();
    expect(within(section('Inbox')).getByText('2 to process.')).toBeDefined();
    expect(screen.getByText('As of 2026-10-08 · 4 to look at')).toBeDefined();
  });

  it('says when the whole week is clear', () => {
    const clear = {
      staleWaiting: [],
      projectsWithoutNextAction: [],
      overdue: [],
      untouchedSomeday: [],
    };
    page({ review: { ...REVIEW, ...clear } });
    expect(screen.getByText('As of 2026-10-08 · nothing to review')).toBeDefined();
  });

  it('says a section is clear rather than leaving it blank', () => {
    page({ review: { ...REVIEW, overdue: [], inbox: { count: 0, more: false } } });
    expect(within(section('Overdue')).getByText('Nothing is late.')).toBeDefined();
    expect(within(section('Inbox')).getByText('Nothing waits to be processed.')).toBeDefined();
  });

  it('moves a task to another status, never offering the one it has or Archive', async () => {
    const props = page();
    const picker = screen.getByRole('combobox', { name: 'Move Learn the cello to' });
    const offered = within(picker)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(offered).toEqual([
      'Move to…',
      'Inbox',
      'Backlog',
      'Next Action',
      'In Progress',
      'Waiting',
      'Longterm',
    ]);
    await userEvent.selectOptions(picker, 'next-action');
    expect(props.onSetStatus).toHaveBeenCalledWith({
      path: 'Tasks/Learn the cello.md',
      status: 'next-action',
    });
  });

  it('offers a late task only the moves that take it off Overdue', () => {
    page();
    const picker = screen.getByRole('combobox', { name: 'Move Ship the review to' });
    expect(
      within(picker)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Move to…', 'Someday', 'Longterm']);
  });

  it('defers and archives a task', async () => {
    const props = page();
    await userEvent.click(screen.getByRole('button', { name: 'Defer Ship the review a week' }));
    expect(props.onDefer).toHaveBeenCalledWith('Tasks/Ship the review.md');
    await userEvent.click(screen.getByRole('button', { name: 'Archive Quote from Larkspur' }));
    expect(props.onArchiveTask).toHaveBeenCalledWith('Tasks/Quote from Larkspur.md');
  });

  it("moves a project to another of its type's statuses, or archives it", async () => {
    const props = page();
    const picker = screen.getByRole('combobox', { name: 'Move Garden to' });
    expect(
      within(picker)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Move to…', 'Planned', 'Paused', 'Done']);
    await userEvent.selectOptions(picker, 'paused');
    expect(props.onSetProjectStatus).toHaveBeenCalledWith({
      path: 'Projects/Garden.md',
      status: 'paused',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Archive Garden' }));
    expect(props.onArchiveProject).toHaveBeenCalledWith('Projects/Garden.md');
    expect(props.onArchiveTask).not.toHaveBeenCalled();
    expect(props.onSetStatus).not.toHaveBeenCalled();
  });

  it('opens an item, and the Inbox', async () => {
    const props = page();
    await userEvent.click(screen.getByRole('button', { name: 'Garden' }));
    expect(props.onOpen).toHaveBeenCalledWith('Projects/Garden.md');
    await userEvent.click(screen.getByRole('button', { name: 'Open the Inbox' }));
    expect(props.onOpenInbox).toHaveBeenCalled();
  });

  it('holds every action while one is under way', () => {
    page({ busy: true });
    const defer = screen.getByRole('button', { name: 'Defer Ship the review a week' });
    expect((defer as HTMLButtonElement).disabled).toBe(true);
    const archive = screen.getByRole('button', { name: 'Archive Garden' });
    expect((archive as HTMLButtonElement).disabled).toBe(true);
    const picker = screen.getByRole('combobox', { name: 'Move Garden to' });
    expect((picker as HTMLSelectElement).disabled).toBe(true);
  });

  it('says why an action could not be done', () => {
    page({ problem: 'A waiting task needs someone to wait on.' });
    expect(screen.getByRole('alert').textContent).toBe('A waiting task needs someone to wait on.');
  });

  it('says why the review could not be read', () => {
    page({ review: null, error: 'The index is closed.' });
    expect(screen.getByRole('alert').textContent).toBe('The index is closed.');
  });

  it('says when the vault held more tasks than were read', () => {
    page({ review: { ...REVIEW, truncated: true } });
    expect(screen.getByText(/some may be missing/)).toBeDefined();
  });
});

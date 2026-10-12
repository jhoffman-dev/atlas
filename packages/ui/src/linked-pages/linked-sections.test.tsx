// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BoardRow, RowGroup } from '@atlas/domain';
import type { LinkedSection } from '@atlas/application';
import { LinkedSections } from './linked-sections.tsx';

const row = (title: string, values: Record<string, unknown> = {}): BoardRow => ({
  path: `notes/${title}.md`,
  title,
  values,
});

const section = (
  given: Partial<LinkedSection> & Pick<LinkedSection, 'id' | 'title'>,
): LinkedSection => ({
  range: null,
  fields: [],
  rows: [],
  groups: [],
  truncated: false,
  hint: null,
  problem: null,
  ...given,
});

const group = (value: string, rows: readonly BoardRow[]): RowGroup => ({
  id: `/${value}`,
  field: 'status',
  kind: 'select',
  label: value,
  value,
  tone: null,
  rows,
  subgroups: [],
});

const MEETINGS = section({
  id: 'meetings',
  title: 'Meetings',
  range: 'recent',
  fields: [{ key: 'date', label: 'Date', kind: 'date' }],
  rows: [row('Kickoff', { date: '2026-10-08' }), row('Retro', { date: '2026-10-01' })],
});

const WAITING = section({
  id: 'waiting',
  title: 'Waiting for',
  fields: [
    { key: 'project', label: 'Project', kind: 'relation' },
    { key: 'waited', label: 'Waiting', kind: 'text' },
  ],
  rows: [row('Send the contract', { project: '[[Payroll Migration]]', waited: 'waiting 12 days' })],
});

function show(sections: readonly LinkedSection[] | null) {
  const onChangeRange = vi.fn();
  const onOpenNote = vi.fn();
  render(
    <LinkedSections sections={sections} onChangeRange={onChangeRange} onOpenNote={onOpenNote} />,
  );
  return { onChangeRange, onOpenNote };
}

const region = (name: string) => screen.getByRole('region', { name });

describe('LinkedSections', () => {
  it('draws nothing until the sections are read, or for a page with none', () => {
    show(null);
    show([]);
    expect(screen.queryByRole('region', { name: 'Linked' })).toBeNull();
    // The absence means something: with a section, the region is there.
    show([MEETINGS]);
    expect(screen.getByRole('region', { name: 'Linked' })).toBeDefined();
  });

  it('heads each section with its name and how many notes it holds', () => {
    show([MEETINGS, WAITING]);
    expect(within(region('Meetings')).getByRole('heading', { name: 'Meetings' })).toBeDefined();
    expect(within(region('Meetings')).getByLabelText('2 notes').textContent).toBe('2');
    expect(within(region('Waiting for')).getByLabelText('1 note').textContent).toBe('1');
  });

  it('draws each row as a way to its note, with its date or how long it has waited', async () => {
    const { onOpenNote } = show([MEETINGS, WAITING]);
    const kickoff = within(region('Meetings')).getByRole('button', { name: 'Kickoff' });
    expect(kickoff.closest('li')?.textContent).toBe('Kickoff2026-10-08');
    const waiting = within(region('Waiting for')).getByRole('button', {
      name: 'Send the contract',
    });
    // A relation is drawn as the note's name, never as its brackets.
    expect(waiting.closest('li')?.textContent).toBe(
      'Send the contractPayroll Migration · waiting 12 days',
    );
    await userEvent.click(kickoff);
    expect(onOpenNote).toHaveBeenCalledWith('notes/Kickoff.md');
  });

  it('offers recent and all only on a section that has both, and says which was chosen', async () => {
    const { onChangeRange } = show([MEETINGS, WAITING]);
    const toggle = within(region('Meetings')).getByRole('radiogroup', {
      name: 'Meetings: how far back',
    });
    expect(
      within(toggle).getByRole('radio', { name: '30 days' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(within(region('Waiting for')).queryByRole('radiogroup')).toBeNull();
    await userEvent.click(within(toggle).getByRole('radio', { name: 'All' }));
    expect(onChangeRange).toHaveBeenCalledWith('meetings', 'all');
  });

  it('folds an empty section to one quiet line that keeps its way to all', () => {
    show([
      section({ id: 'meetings', title: 'Meetings', range: 'recent' }),
      section({ id: 'decisions', title: 'Decisions', range: 'all' }),
      section({ id: 'waiting', title: 'Waiting for' }),
    ]);
    expect(region('Meetings').textContent).toBe('Meetingsnone in the last 30 days30 daysAll');
    expect(within(region('Meetings')).getByRole('radio', { name: 'All' })).toBeDefined();
    expect(within(region('Meetings')).queryByRole('list')).toBeNull();
    expect(within(region('Meetings')).queryByLabelText(/notes?$/)).toBeNull();
    expect(region('Decisions').textContent).toBe('Decisionsnone30 daysAll');
    expect(region('Waiting for').textContent).toBe('Waiting fornone');
  });

  it('draws the first eight rows, then the rest on Show more, and fewer again', async () => {
    const rows = Array.from({ length: 11 }, (_, at) => row(`Meeting ${at + 1}`));
    show([section({ id: 'meetings', title: 'Meetings', rows })]);
    const meetings = within(region('Meetings'));
    expect(meetings.getAllByRole('listitem')).toHaveLength(8);
    expect(meetings.getByLabelText('11 notes').textContent).toBe('11');
    await userEvent.click(meetings.getByRole('button', { name: 'Show 3 more' }));
    expect(meetings.getAllByRole('listitem')).toHaveLength(11);
    expect(meetings.queryByRole('button', { name: /Show \d+ more/ })).toBeNull();
    await userEvent.click(meetings.getByRole('button', { name: 'Show fewer' }));
    expect(meetings.getAllByRole('listitem')).toHaveLength(8);
  });

  it('offers no Show more for a section that fits', () => {
    show([MEETINGS]);
    expect(within(region('Meetings')).queryByRole('button', { name: /Show/ })).toBeNull();
  });

  it('says when a section holds only the first of more', async () => {
    const rows = Array.from({ length: 9 }, (_, at) => row(`Meeting ${at + 1}`));
    show([section({ id: 'meetings', title: 'Meetings', rows, truncated: true })]);
    const meetings = within(region('Meetings'));
    expect(meetings.getByLabelText('9+ notes').textContent).toBe('9+');
    expect(meetings.queryByText(/there are more/)).toBeNull();
    await userEvent.click(meetings.getByRole('button', { name: 'Show 1 more' }));
    expect(meetings.getByText('These are the first 9; there are more.')).toBeDefined();
  });

  it('draws open tasks under their statuses, with a hint over them', async () => {
    const next = [row('Draft the plan')];
    const inbox = [row('Book a room'), row('Order badges')];
    show([
      section({
        id: 'tasks',
        title: 'Open tasks',
        rows: [...next, ...inbox],
        groups: [group('next-action', next), group('inbox', inbox)],
        hint: 'No next action: none of its 3 open tasks is Next Action or In Progress.',
      }),
    ]);
    const tasks = within(region('Open tasks'));
    expect(tasks.getByRole('note').textContent).toContain('No next action: none of its 3');
    const groups = tasks.getAllByRole('group').map((found) => found.getAttribute('aria-label'));
    expect(groups).toEqual(['next-action', 'inbox']);
    expect(
      within(tasks.getByRole('group', { name: 'inbox' })).getAllByRole('listitem'),
    ).toHaveLength(2);
    // A status folds shut and open like a view's group.
    await userEvent.click(
      within(tasks.getByRole('group', { name: 'inbox' })).getByRole('button', { expanded: true }),
    );
    expect(tasks.queryByRole('button', { name: 'Book a room' })).toBeNull();
    expect(tasks.getByRole('button', { name: 'Draft the plan' })).toBeDefined();
  });

  it('says why a section could not be answered, in place of its rows', () => {
    show([section({ id: 'waiting', title: 'Waiting for', problem: 'database is locked' })]);
    expect(within(region('Waiting for')).getByRole('alert').textContent).toBe('database is locked');
    expect(region('Waiting for').textContent).toBe('Waiting fordatabase is locked');
  });
});

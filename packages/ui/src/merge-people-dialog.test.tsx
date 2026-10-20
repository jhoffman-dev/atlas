// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  MergePeopleDialog,
  type MergeDialogState,
  type MergePreviewView,
} from './merge-people-dialog.tsx';

const PREVIEW: MergePreviewView = {
  keep: 'Mara Quill',
  merge: ['Mara'],
  notes: 2,
  links: 5,
  conflicts: [{ key: 'role', kept: 'Payroll lead', other: 'Analyst', from: 'Mara' }],
  aliasesAdded: ['Mara', 'MQ'],
  emailsAdded: ['mara@larkspur.example.com'],
  bodies: 1,
};

function draw(state: MergeDialogState, more: { onSwap?: () => void } = {}) {
  const calls = { onPick: vi.fn(), onConfirm: vi.fn(), onClose: vi.fn() };
  render(<MergePeopleDialog subject="Mara" state={state} {...calls} {...more} />);
  return calls;
}

describe('MergePeopleDialog', () => {
  it('lists the people to keep, narrows them as typed, and picks one with Enter', () => {
    const calls = draw({
      kind: 'picking',
      choices: [
        { path: 'People/Mara Quill.md', name: 'Mara Quill', place: 'People' },
        { path: 'Tobias Fenn.md', name: 'Tobias Fenn', place: '' },
      ],
    });
    const people = screen.getByRole('listbox', { name: 'People' });
    expect(
      within(people)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Mara QuillPeople', 'Tobias Fenn']);
    const field = screen.getByRole('searchbox', { name: 'Find the person to keep' });
    fireEvent.change(field, { target: { value: 'tob' } });
    expect(within(people).getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(calls.onPick).toHaveBeenCalledWith('Tobias Fenn.md');
  });

  it('says there is no one to keep when the vault has only this person', () => {
    draw({ kind: 'picking', choices: [] });
    expect(screen.getByText('There is no one else to merge into.')).toBeTruthy();
  });

  it('says what the merge changes, the values kept, and that the merged person goes to the Trash', () => {
    const calls = draw({ kind: 'previewed', preview: PREVIEW });
    expect(screen.getByRole('heading', { name: 'Merge Mara into Mara Quill?' })).toBeTruthy();
    const summary = screen.getByRole('list', { name: 'What the merge changes' });
    expect(
      within(summary)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      '5 links in 2 notes will open Mara Quill.',
      'Adds 2 aliases: Mara, MQ.',
      'Adds 1 email: mara@larkspur.example.com.',
      'Adds the text of 1 note at the end, under “Merged from…”.',
    ]);
    const kept = screen.getByRole('region', { name: 'Values kept as they are' });
    expect(kept.textContent).toContain('role Payroll lead (not Analyst, from Mara)');
    expect(screen.getByText(/Mara goes to the Trash/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /instead/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    expect(calls.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('says nothing links to the merged person, and leaves out what does not change', () => {
    draw({
      kind: 'previewed',
      preview: {
        ...PREVIEW,
        links: 0,
        notes: 0,
        conflicts: [],
        aliasesAdded: [],
        emailsAdded: [],
        bodies: 0,
      },
    });
    const summary = screen.getByRole('list', { name: 'What the merge changes' });
    expect(
      within(summary)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['No other note links to Mara.']);
    expect(screen.queryByRole('region', { name: 'Values kept as they are' })).toBeNull();
  });

  it('offers to keep the other person instead, when asked from the list', () => {
    const onSwap = vi.fn();
    draw({ kind: 'previewed', preview: PREVIEW }, { onSwap });
    fireEvent.click(screen.getByRole('button', { name: 'Keep Mara instead' }));
    expect(onSwap).toHaveBeenCalledTimes(1);
  });

  it('holds the answers while the merge is being made', () => {
    const calls = draw({ kind: 'merging', preview: PREVIEW }, { onSwap: vi.fn() });
    const merging = screen.getByRole('button', { name: 'Merging…' }) as HTMLButtonElement;
    expect(merging.disabled).toBe(true);
    fireEvent.click(merging);
    expect(calls.onConfirm).not.toHaveBeenCalled();
    expect(
      (screen.getByRole('button', { name: 'Keep Mara instead' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('says why the people cannot be merged, with only a way out', () => {
    const calls = draw({ kind: 'refused', message: 'Plan is not a person.' });
    expect(screen.getByRole('alert').textContent).toBe('Plan is not a person.');
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(calls.onClose).toHaveBeenCalled();
  });

  it('shows the wait while the merge is worked out', () => {
    draw({ kind: 'checking' });
    expect(screen.getByRole('status').textContent).toBe('Working out the merge…');
  });
});

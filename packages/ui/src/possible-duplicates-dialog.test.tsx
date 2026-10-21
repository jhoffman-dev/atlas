// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { PossibleDuplicatesDialog, type DuplicatesState } from './possible-duplicates-dialog.tsx';

const READY: DuplicatesState = {
  kind: 'ready',
  pairs: [
    {
      key: 'a',
      left: { path: 'People/Tobias Fenn.md', name: 'Tobias Fenn', place: 'People' },
      right: { path: 'Tobias Fenn.md', name: 'Tobias Fenn', place: '' },
      reasons: [{ text: 'Same name', hue: 'blue' }],
    },
    {
      key: 'b',
      left: { path: 'Mara.md', name: 'Mara', place: '' },
      right: { path: 'People/Mara Quill.md', name: 'Mara Quill', place: 'People' },
      reasons: [
        { text: 'Alias', hue: 'purple', detail: 'Mara' },
        { text: 'First name and full name', hue: 'yellow', detail: 'mara@… · mara.quill@…' },
      ],
    },
  ],
};

function draw(state: DuplicatesState) {
  const calls = { onOpen: vi.fn(), onMerge: vi.fn(), onDismiss: vi.fn(), onClose: vi.fn() };
  render(<PossibleDuplicatesDialog state={state} {...calls} />);
  return calls;
}

describe('PossibleDuplicatesDialog', () => {
  it('lists each pair with its reasons drawn as tinted chips', () => {
    draw(READY);
    const list = screen.getByRole('list', { name: 'People who may be one' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      'Tobias Fenn and Tobias Fenn',
      'Mara and Mara Quill',
    ]);
    const chips = rows[1]!.querySelectorAll('.status-pill');
    expect([...chips].map((chip) => [chip.textContent, chip.getAttribute('data-hue')])).toEqual([
      ['Alias', 'purple'],
      ['First name and full name', 'yellow'],
    ]);
    expect(within(rows[1]!).getByText('mara@… · mara.quill@…')).toBeTruthy();
    expect(within(rows[0]!).getByText('People')).toBeTruthy();
  });

  it('merges, dismisses or opens the pair it is pressed on', () => {
    const calls = draw(READY);
    const mara = screen.getByRole('listitem', { name: 'Mara and Mara Quill' });
    fireEvent.click(within(mara).getByRole('button', { name: 'Merge…' }));
    expect(calls.onMerge).toHaveBeenCalledWith('b');
    fireEvent.click(within(mara).getByRole('button', { name: 'Not the same' }));
    expect(calls.onDismiss).toHaveBeenCalledWith('b');
    fireEvent.click(within(mara).getByRole('button', { name: /Mara QuillPeople/ }));
    expect(calls.onOpen).toHaveBeenCalledWith('People/Mara Quill.md');
  });

  it('says so when no two people look alike', () => {
    draw({ kind: 'ready', pairs: [] });
    expect(screen.getByText('No two people look alike.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'People who may be one' })).toBeNull();
  });

  it('says why the list could not be read', () => {
    draw({ kind: 'failed', message: '.atlas/settings.md can’t be read' });
    expect(screen.getByRole('alert').textContent).toBe('.atlas/settings.md can’t be read');
  });

  it('shows the wait while the list is read', () => {
    draw({ kind: 'loading' });
    expect(screen.getByRole('status').textContent).toBe('Looking for people who may be one…');
  });
});

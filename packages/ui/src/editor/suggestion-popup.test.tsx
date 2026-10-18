// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SuggestionPopup, type PopupItem } from './suggestion-popup.tsx';

afterEach(cleanup);

const NOTES: readonly PopupItem[] = [
  { id: 'Plans/Rome.md', label: 'Rome', hint: 'Plans' },
  { id: 'Plans/Naples.md', label: 'Naples', hint: 'Plans' },
];

function popup(given: Partial<Parameters<typeof SuggestionPopup>[0]> = {}) {
  const onPick = vi.fn();
  render(
    <SuggestionPopup
      label="Link to note"
      items={NOTES}
      selected={0}
      rect={null}
      onPick={onPick}
      {...given}
    />,
  );
  return onPick;
}

describe('a suggestion popup', () => {
  it('is the one popup list, with each row named and its place as the hint', () => {
    popup();
    const list = screen.getByRole('listbox', { name: 'Link to note' });
    expect(list.className).toBe('suggestions');
    const rows = within(list).getAllByRole('option');
    expect(rows.map((row) => row.textContent)).toEqual(['RomePlans', 'NaplesPlans']);
    expect(rows.map((row) => row.className)).toEqual([
      'suggest-option suggest-option--on',
      'suggest-option',
    ]);
  });

  it('hands over the row picked, and whether it was picked the other way', () => {
    const onPick = popup();
    fireEvent.mouseDown(screen.getByRole('option', { name: /Naples/ }));
    expect(onPick).toHaveBeenLastCalledWith('Plans/Naples.md', false);
    fireEvent.mouseDown(screen.getByRole('option', { name: /Rome/ }), { shiftKey: true });
    expect(onPick).toHaveBeenLastCalledWith('Plans/Rome.md', true);
  });

  it('lists its keys along the foot as decoration, outside the options', () => {
    popup({
      hints: [
        ['↵', 'Link'],
        ['⇧ ↵', 'Bookmark'],
      ],
    });
    const list = screen.getByRole('listbox', { name: 'Link to note' });
    expect(within(list).getAllByRole('option')).toHaveLength(2);
    const foot = list.querySelector('.suggestions__hints');
    expect(foot?.getAttribute('aria-hidden')).toBe('true');
    expect(foot?.textContent).toBe('↵Link⇧↵Bookmark');
  });

  it('widens for a note’s blocks', () => {
    popup({ variant: 'blocks', label: 'Link to block' });
    expect(screen.getByRole('listbox', { name: 'Link to block' }).className).toBe(
      'suggestions suggestions--blocks',
    );
  });

  it('draws nothing with nothing to offer', () => {
    popup({ items: [] });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

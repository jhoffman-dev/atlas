import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Whether an option's spoken name is this note's: its title, then what follows a comma. */
export const optionNamed =
  (title: string) =>
  (name: string): boolean =>
    name === title || name.startsWith(`${title},`);

/** The notes a link field's open list offers, by title, in order. */
export function suggestedTitles(): string[] {
  const list = screen.queryByRole('listbox', { name: 'Suggested notes' });
  if (list === null) return [];
  return within(list)
    .queryAllByRole('option')
    .map((option) => option.querySelector('.link-suggest__title')?.textContent ?? '')
    .filter((title) => title !== '');
}

/**
 * Picks a note in a link field as a person does (#465): types the start of
 * its title — or `typed` — and clicks the suggestion.
 */
export async function pickSuggestion(
  field: HTMLElement,
  title: string,
  typed = title.slice(0, 3),
): Promise<void> {
  await userEvent.clear(field);
  await userEvent.type(field, typed);
  await userEvent.click(await screen.findByRole('option', { name: optionNamed(title) }));
}

/**
 * Picks the best match for `typed` in a link field, at once and without a
 * user-event's awaits: focus, type, ↵ — for a test that times what follows.
 */
export function pickTyped(field: HTMLElement, typed: string): void {
  act(() => field.focus());
  fireEvent.change(field, { target: { value: typed } });
  fireEvent.keyDown(field, { key: 'Enter' });
}

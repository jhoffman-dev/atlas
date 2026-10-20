import type { Locator } from './fixtures.ts';

/** Text matched literally inside a regular expression. */
const literally = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The note a link field's open list suggests by `title` (#465): its spoken
 * name is the title, then its alias, type and folder after commas.
 */
export function suggestion(field: Locator, title: string): Locator {
  return field
    .page()
    .getByRole('listbox', { name: 'Suggested notes' })
    .getByRole('option', { name: new RegExp(`^${literally(title)}(,|$)`) });
}

/** The titles of the notes a link field's open list suggests, as a locator to read or poll. */
export function suggestedTitles(field: Locator): Locator {
  return field
    .page()
    .getByRole('listbox', { name: 'Suggested notes' })
    .locator('.link-suggest__title');
}

/**
 * Picks a note in a link field as a person does (#465): types the start of
 * its title — or `typed` — and clicks the suggestion.
 */
export async function pickSuggestion(
  field: Locator,
  title: string,
  typed = title.slice(0, 3),
): Promise<void> {
  await field.click();
  await field.fill(typed);
  await suggestion(field, title).click();
}

/** Makes a note of `target` called `name` from a link field, as "Create <type> '<name>'" does. */
export async function createFromSuggestion(
  field: Locator,
  target: string,
  name: string,
): Promise<void> {
  await field.click();
  await field.fill(name);
  await field
    .page()
    .getByRole('listbox', { name: 'Suggested notes' })
    .getByRole('option', { name: `Create ${target} ‘${name}’` })
    .click();
}

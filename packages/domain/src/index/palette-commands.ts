/**
 * Things the search palette can do as well as find: "New query", "New view".
 *
 * A command is offered once every word typed is in its name, so "query",
 * "new q" and "sql" (a word it lists as a synonym) all find New query, and an
 * empty palette stays a search box rather than a menu.
 */

export interface PaletteCommand {
  readonly id: string;
  readonly label: string;
  /** Other words it answers to, which are not shown. */
  readonly keywords?: readonly string[];
}

export function matchingCommands<Command extends PaletteCommand>(
  query: string,
  commands: readonly Command[],
): Command[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '');
  if (words.length === 0) return [];
  return commands.filter((command) => {
    const said = [command.label, ...(command.keywords ?? [])].join(' ').toLowerCase();
    return words.every((word) => said.includes(word));
  });
}

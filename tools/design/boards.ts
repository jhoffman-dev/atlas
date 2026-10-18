// The mockups in design/target: which boards there are, what `design:refs`
// renders each one as, and their source for `dc-render`.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { themesOf } from './dc-render.ts';

export const TARGET = join(import.meta.dirname, '..', '..', 'design', 'target');
const SUFFIX = '.dc.html';

/** One render of a board: in one of its theme options, or as it is when it has no theme prop. */
export interface BoardRender {
  board: string;
  theme: string | null;
}

/** Reads a board's source by name, e.g. `Sidebar` → `design/target/Sidebar.dc.html`. */
export function loadBoard(name: string): string {
  return readFileSync(join(TARGET, `${name}${SUFFIX}`), 'utf8');
}

/** Every render `design:refs` makes, in file order; a themed board renders once per theme option. */
export function boardRenders(parser: DOMParser): BoardRender[] {
  const files = readdirSync(TARGET)
    .filter((file) => file.endsWith(SUFFIX))
    .sort();
  return files.flatMap((file): BoardRender[] => {
    const board = file.slice(0, -SUFFIX.length);
    const themes = themesOf(loadBoard(board), parser);
    return themes.length ? themes.map((theme) => ({ board, theme })) : [{ board, theme: null }];
  });
}

/** The PNG name of a render, as `design:refs` writes it under design/out/refs. */
export function renderName({ board, theme }: BoardRender): string {
  return theme ? `${board}-${theme}` : board;
}

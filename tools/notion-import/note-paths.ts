import {
  cleanEntryName,
  createVaultPath,
  DEFAULT_NOTE_NAME,
  fitFileNameStem,
  foldedVaultPath,
  linkBreakingCharacter,
  linkTakeover,
  nextAvailableNotePath,
  type VaultPath,
} from '../../packages/domain/src/index.ts';
import { dailyNotePath } from '../../packages/application/src/notes/daily-note.ts';
import type { ImportRecord } from './import-record.ts';
import type { ExportPage } from './row-pages.ts';
import type { VaultNotes } from './vault-notes.ts';
import { placeOf, rowDay, type NoteKind } from './workspace-databases.ts';

/** A row of a database this import writes itself, paired with its page. */
export interface Candidate {
  readonly database: {
    readonly name: string;
    readonly kind: NoteKind;
    readonly csv: { readonly columns: readonly string[] };
  };
  readonly title: string;
  readonly row: ReadonlyMap<string, string>;
  readonly page: ExportPage & { readonly id: string };
}

/** Where a page's note is, or will be, or why it has none. */
export type NotePlace =
  | {
      readonly kind: 'placed';
      readonly path: VaultPath;
      /**
       * How the note at the path comes in: made afresh (`none`); merged against
       * the record, being the page's own note (`recorded`); or merged as a first
       * import, being a note the page fills in that does not yet hold its
       * `notion_id`, such as the vault's own note for a day (`fresh`).
       */
      readonly merge: 'none' | 'recorded' | 'fresh';
      readonly notes: readonly string[];
    }
  | { readonly kind: 'deleted' }
  | { readonly kind: 'refused'; readonly reason: string };

/** What placing every page needs besides the pages. */
export interface PlaceInput {
  readonly vault: VaultNotes;
  readonly record: ImportRecord;
  readonly recreateDeleted: boolean;
  readonly timeZone: string | null;
}

/**
 * A title as a note's name that links can reach and the vault walk finds
 * again: link syntax (`#`, `|`, `^`, brackets) taken out, a markdown
 * extension of its own kept as a word, so the file is `<name>.md`, and cut
 * to what a file name can hold, numbering included.
 */
function nameFor(title: string): string {
  let name = title;
  for (let character = linkBreakingCharacter(name); character !== null;) {
    name = name.replaceAll(character, ' ');
    character = linkBreakingCharacter(name);
  }
  // Cut first: a cut can leave the name ending in `.markdown`, which links would read as its extension.
  const fitted = fitFileNameStem(cleanEntryName(name), ' 9999.md').replace(
    /\.(md|markdown)$/i,
    ' $1',
  );
  return fitted === '' ? DEFAULT_NOTE_NAME : fitted;
}

/** What the report says when a note's name is not its title. */
function renamed(title: string, name: string): string[] {
  return name === cleanEntryName(title) || cleanEntryName(title) === ''
    ? []
    : [`named "${name}": a file name or a link could not hold its title as it is`];
}

/**
 * Where every page's note is, or will be, planned before anything is
 * written, for every database in the export (chosen or not) so links to a
 * page this run leaves out still name its note:
 *
 * - where a note already holds its `notion_id`, wherever it was moved;
 * - nowhere, when the record says it was imported and its note is gone: it
 *   was deleted in Atlas (or hidden), and is not made again unless asked;
 * - a daily note at the app's own path, `<YYYY-MM-DD>.md` at the root,
 *   filling in the day's note when there is one;
 * - else a new path in its database's folder, numbered when the name is
 *   taken, and numbered on when the name would take another note's
 *   `[[links]]` (the app's rule when it adds a person).
 */
export function notePaths(input: PlaceInput): (candidate: Candidate) => NotePlace {
  const taken = new Set<string>(input.vault.paths);
  const notes = [...input.vault.paths];
  const existing = new Map(input.vault.paths.map((path) => [foldedVaultPath(path), path]));
  const pageNotes = new Set([...input.vault.byNotionId.values()].flat());
  const days = new Map<string, string>();
  const claim = (path: VaultPath) => {
    taken.add(path);
    notes.push(path);
  };

  /** The day's note: the app's path for it, already there or to be made. */
  function dailyPlace(candidate: Candidate): NotePlace {
    const day = rowDay({
      ...candidate,
      kind: 'daily',
      columns: candidate.database.csv.columns,
      timeZone: input.timeZone,
    });
    if (day === null) return { kind: 'refused', reason: 'neither its Date nor its title is a day' };
    const other = days.get(day);
    if (other !== undefined)
      return { kind: 'refused', reason: `"${other}" is the daily note for ${day} too` };
    days.set(day, candidate.title);
    const path = dailyNotePath(day);
    // The vault's own note for the day, at the app's path or anywhere [[day]] opens it.
    const there = existing.get(foldedVaultPath(path)) ?? linkTakeover(path, notes) ?? undefined;
    if (there !== undefined && pageNotes.has(there)) {
      return {
        kind: 'refused',
        reason: `${there}, the note for ${day}, holds another Notion page`,
      };
    }
    if (there !== undefined) {
      const elsewhere =
        there === path
          ? []
          : [
              `filled ${there}, the vault's note for ${day}: one at ${path} would take its [[${day}]] links`,
            ];
      return { kind: 'placed', path: there, merge: 'fresh', notes: elsewhere };
    }
    claim(path);
    return { kind: 'placed', path, merge: 'none', notes: [] };
  }

  /** A new note's path in its folder, numbered past a taken name and past one that would take another note's links. */
  function newPlace(candidate: Candidate): NotePlace {
    const { database, title, row } = candidate;
    const folder = createVaultPath(
      placeOf({ kind: database.kind, columns: database.csv.columns, row }).folder,
    );
    const name = nameFor(title);
    const tried = new Set(taken);
    let path = nextAvailableNotePath({ folder, name: `${name}.md`, taken: tried });
    const overtaken = linkTakeover(path, notes);
    for (let takes = overtaken; takes !== null; takes = linkTakeover(path, notes)) {
      tried.add(path);
      path = nextAvailableNotePath({ folder, name: `${name}.md`, taken: tried });
    }
    const takeover =
      overtaken === null
        ? []
        : [`[[${name}]] already opens ${overtaken}: named ${path} so it does not take its links`];
    claim(path);
    return { kind: 'placed', path, merge: 'none', notes: [...renamed(title, name), ...takeover] };
  }

  return (candidate) => {
    const found = input.vault.byNotionId.get(candidate.page.id) ?? [];
    if (found.length > 1) {
      return {
        kind: 'refused',
        reason: `${found.join(' and ')} all hold its notion_id: merge them first`,
      };
    }
    if (found[0] !== undefined)
      return { kind: 'placed', path: found[0], merge: 'recorded', notes: [] };
    if (input.record.has(candidate.page.id) && !input.recreateDeleted) return { kind: 'deleted' };
    return candidate.database.kind === 'daily' ? dailyPlace(candidate) : newPlace(candidate);
  };
}

/** The daily notes already in the vault that daily rows would fill in, for the run to read before it plans. */
export function dailyNotesToRead(candidates: readonly Candidate[], input: PlaceInput): VaultPath[] {
  const existing = new Map(input.vault.paths.map((path) => [foldedVaultPath(path), path]));
  return candidates
    .filter((candidate) => candidate.database.kind === 'daily')
    .flatMap((candidate) => {
      const day = rowDay({
        ...candidate,
        kind: 'daily',
        columns: candidate.database.csv.columns,
        timeZone: input.timeZone,
      });
      if (day === null) return [];
      const path = dailyNotePath(day);
      const there = existing.get(foldedVaultPath(path)) ?? linkTakeover(path, input.vault.paths);
      return there === null || there === undefined ? [] : [there];
    });
}

import {
  archiveStamp,
  ARCHIVE_PREFIX,
  isArchivedPath,
  joinFrontmatter,
  splitFrontmatter,
  wikiLinkTargetFor,
  type VaultPath,
} from '../../packages/domain/src/index.ts';
import { remarkMarkdown } from '../../packages/adapters/src/index.ts';
import type { ImportRecord } from './import-record.ts';
import { importedAs, mergeNote, type ImportedPage, type WantedContent } from './note-merge.ts';
import { dailyNotesToRead, notePaths, type Candidate, type NotePlace } from './note-paths.ts';
import type { RelationEntry } from './notion-relations.ts';
import { withWikiLinks } from './page-links.ts';
import { pairRows, propertiesHold, type ExportPage, type PairedRow } from './row-pages.ts';
import type { GtdStatus } from '../../packages/domain/src/index.ts';
import type { VaultNotes } from './vault-notes.ts';
import { readFrontmatter } from './vault-meetings.ts';
import {
  columnsLeftOut,
  wantedNote,
  type DatabaseKind,
  type ResolvedLink,
  type WantedNote,
} from './workspace-databases.ts';
import type { ExportDatabase } from './workspace-export.ts';

/** What the plan says of one page, and of the database it is in. */
export interface Named {
  readonly database: string;
  readonly title: string;
}

/** A page whose note this run makes or keeps in step. */
export interface Placed extends Named {
  readonly id: string;
  readonly path: VaultPath;
  /** The type its note is written as. */
  readonly type: string;
  /** What the report should say about the page. */
  readonly notes: readonly string[];
  /** What this run brings in, for the record. */
  readonly imported: ImportedPage;
}

/** What becomes of one page of the export. */
export type PagePlan =
  | ({ readonly kind: 'create'; readonly content: string } & Placed)
  | ({
      readonly kind: 'update';
      /** The note's text as read, so the write can tell whether it changed since. */
      readonly before: string;
      readonly after: string;
      readonly changed: readonly string[];
      readonly kept: readonly string[];
      /** Whether no run recorded importing it, so the changes only fill in what it lacked. */
      readonly filled: boolean;
    } & Placed)
  | ({
      readonly kind: 'unchanged';
      readonly kept: readonly string[];
      /** Left unfilled with no record of an earlier import (`--no-fill-unrecorded`): nothing is recorded for it either. */
      readonly unrecorded?: true;
    } & Placed)
  /** Imported before, and its note is gone from the vault: deleted (or hidden) in Atlas, so not made again. */
  | ({ readonly kind: 'deleted'; readonly id: string } & Named)
  | ({ readonly kind: 'refused'; readonly reason: string } & Named);

/** Something in the export not brought in, and why. */
export interface Skipped {
  readonly what: string;
  readonly reason: string;
}

export interface WorkspacePlan {
  readonly pages: readonly PagePlan[];
  readonly skipped: readonly Skipped[];
}

/** Everything the plan is made from: the export, the vault as read, and how to read it. */
export interface PlanInput {
  readonly databases: readonly ExportDatabase[];
  readonly selected: ReadonlySet<DatabaseKind>;
  readonly vault: VaultNotes;
  /** The text of each note a page is already in; null for one that is not UTF-8. */
  readonly texts: ReadonlyMap<VaultPath, string | null>;
  readonly record: ImportRecord;
  readonly statuses: ReadonlyMap<string, GtdStatus>;
  readonly today: string;
  readonly timeZone: string | null;
  /** Makes again the notes of pages imported before whose notes are gone. */
  readonly recreateDeleted: boolean;
  /** The note of each Meeting Notes page, by its page id, as the meeting import placed it in this run. */
  readonly meetingPaths: ReadonlyMap<string, VaultPath>;
  /** Every Meeting Notes page id in the export, placed or not. */
  readonly meetingIds: ReadonlySet<string>;
  /** Whether a note with no record of an earlier import is filled in where it lacks a property. */
  readonly fillUnrecorded: boolean;
}

const writesItself = (
  database: ExportDatabase,
): database is Candidate['database'] & ExportDatabase =>
  database.kind !== null && database.kind !== 'meetings';

/**
 * A paired row's page, with its id, or why it cannot be planned: no page, no
 * id in its file name, or the same page already seen elsewhere in the export.
 * Each page seen is remembered in `seen`.
 */
function checkedPage(paired: PairedRow, seen: Map<string, string>): Candidate['page'] | string {
  if (paired.kind === 'unpaired') return paired.reason;
  const { page } = paired;
  if (page.id === null) return `its page ${page.file} has no Notion id in its name`;
  const earlier = seen.get(page.id);
  if (earlier !== undefined) return `the export holds its page twice: ${earlier} too`;
  seen.set(page.id, page.file);
  return { ...page, id: page.id };
}

/** What a chosen database leaves out, for the report: pages no row has, and columns not imported. */
function skipsOf(database: Candidate['database'], leftOver: readonly ExportPage[]): Skipped[] {
  const reason = `no row of ${database.name} has its title`;
  return [
    ...leftOver.map((page) => ({ what: page.file, reason })),
    ...columnsLeftOut(database.kind, database.csv.columns).map((why) => ({
      what: database.name,
      reason: why,
    })),
  ];
}

/** The pages to plan, each once, and the refusals and skips found on the way. */
function candidatesOf(input: Pick<PlanInput, 'databases' | 'selected'>) {
  const candidates: Candidate[] = [];
  const refused: PagePlan[] = [];
  const skipped: Skipped[] = [];
  const seen = new Map<string, string>();
  for (const database of input.databases.filter(writesItself)) {
    const chosen = input.selected.has(database.kind);
    const { rows, leftOver } = pairRows(database.csv, database.pages);
    for (const paired of rows) {
      const page = checkedPage(paired, seen);
      const named = { database: database.name, title: paired.title };
      if (typeof page !== 'string' && paired.kind === 'paired') {
        candidates.push({ database, title: paired.title, row: paired.row, page });
      } else if (chosen && typeof page === 'string') {
        refused.push({ kind: 'refused', ...named, reason: page });
      }
    }
    if (chosen) skipped.push(...skipsOf(database, leftOver));
  }
  return { candidates, refused, skipped };
}

/** Every page's place, in the export's order. */
function placesOf(candidates: readonly Candidate[], input: PlanInput): Map<string, NotePlace> {
  const place = notePaths(input);
  return new Map(candidates.map((candidate) => [candidate.page.id, place(candidate)]));
}

/** Why a link to a page by its id names no note: the report's words. */
function unplacedBecause(
  id: string,
  places: ReadonlyMap<string, NotePlace>,
  input: PlanInput,
): string {
  if (places.get(id)?.kind === 'deleted') return 'was deleted in Atlas';
  if (input.meetingIds.has(id)) return 'is a meeting this run does not bring in';
  return 'is not in this run';
}

/**
 * Links to the notes of the export's pages and meetings, by page id. A
 * relation that names a page by id links its note, or, when that page has
 * none this run, its title, noted — never another page of the same title.
 * Only a relation with no id is matched by a title one page alone has.
 */
function linking(
  candidates: readonly Candidate[],
  places: ReadonlyMap<string, NotePlace>,
  input: PlanInput,
) {
  const paths = new Map<string, VaultPath>(input.meetingPaths);
  for (const [id, place] of places) if (place.kind === 'placed') paths.set(id, place.path);
  for (const [id, found] of input.vault.byNotionId) {
    if (found.length === 1 && found[0] !== undefined && !paths.has(id)) paths.set(id, found[0]);
  }
  const notes = [...new Set([...input.vault.paths, ...paths.values()])];
  const targets = new Map<VaultPath, string>();
  const targetOf = (path: VaultPath) => {
    const known = targets.get(path) ?? wikiLinkTargetFor(path, notes);
    targets.set(path, known);
    return known;
  };
  const byTitle = new Map<string, VaultPath | null>();
  for (const { title, page } of candidates) {
    const path = paths.get(page.id);
    if (path !== undefined) byTitle.set(title, byTitle.has(title) ? null : path);
  }
  const linkFor = (id: string) => {
    const path = paths.get(id);
    return path === undefined ? null : targetOf(path);
  };
  const resolve = (entry: RelationEntry): ResolvedLink => {
    const path = entry.id === null ? byTitle.get(entry.title) : paths.get(entry.id);
    if (path !== null && path !== undefined) return { link: `[[${targetOf(path)}]]`, known: true };
    const link = `[[${entry.title}]]`;
    if (entry.id === null) return { link, known: false };
    return { link, known: false, why: unplacedBecause(entry.id, places, input) };
  };
  return { linkFor, resolve };
}

/** The page's body as a note's: its own words, links to other pages made wiki links, on a line after the properties. */
function bodyOf(candidate: Candidate, linkFor: (id: string) => string | null): string {
  const { page } = candidate.page;
  const own = propertiesHold(candidate.row, page) ? page.body : page.withProperties;
  const text = withWikiLinks(own, linkFor).trim();
  return text === '' ? '' : `\n${text}\n`;
}

/** A new note's properties: Notion's, then those set once, then where it came from. */
function creationProperties(wanted: WantedContent): Record<string, unknown> {
  const { source, notion_id: notionId, ...rest } = wanted.fields;
  return { ...rest, ...wanted.fillOnly, source, notion_id: notionId };
}

function created(placed: Omit<Placed, 'imported'>, wanted: WantedContent): PagePlan {
  const frontmatter = remarkMarkdown.updateFrontmatter(null, creationProperties(wanted));
  const content = joinFrontmatter(frontmatter, wanted.body);
  return { kind: 'create', ...placed, content, imported: importedAs(wanted) };
}

/** The note the page is in, brought into step with it where Atlas has not changed it since the last run. */
function merged(
  placed: Omit<Placed, 'imported'>,
  wanted: WantedContent,
  input: PlanInput & { readonly last: ImportedPage | null },
): PagePlan {
  const text = input.texts.get(placed.path);
  const named = { database: placed.database, title: placed.title };
  if (text === null || text === undefined) {
    return { kind: 'refused', ...named, reason: `${placed.path} is not UTF-8 text: not changed` };
  }
  const { frontmatter, body } = splitFrontmatter(text);
  const { properties, problem } =
    frontmatter === null ? { properties: {}, problem: null } : readFrontmatter(frontmatter);
  if (problem !== null) {
    return {
      kind: 'refused',
      ...named,
      reason: `${placed.path}'s properties cannot be read (${problem}): not changed`,
    };
  }
  const { last } = input;
  if (last === null && !input.fillUnrecorded) {
    const notes = [
      ...placed.notes,
      'no record of an earlier import: left as it is (--no-fill-unrecorded)',
    ];
    return {
      kind: 'unchanged',
      ...placed,
      notes,
      kept: [],
      imported: importedAs(wanted),
      unrecorded: true,
    };
  }
  const merge = mergeNote({ now: { properties, body }, wanted, last });
  const after = joinFrontmatter(
    remarkMarkdown.updateFrontmatter(frontmatter, merge.changes),
    merge.body ?? body,
  );
  const changed = [...Object.keys(merge.changes), ...(merge.body === null ? [] : ['body'])];
  const common = { ...placed, kept: merge.kept, imported: merge.imported };
  if (after === text) return { kind: 'unchanged', ...common };
  return { kind: 'update', ...common, before: text, after, changed, filled: last === null };
}

/** What the page should be, with the Archive's own stamp on a note that is in the Archive (`archiveStamp`). */
function wantedContent(note: WantedNote, path: VaultPath, body: string): WantedContent {
  const stamp =
    note.archivedOn !== null && isArchivedPath(path)
      ? archiveStamp({ from: path.slice(ARCHIVE_PREFIX.length) as VaultPath, on: note.archivedOn })
      : {};
  return {
    fields: note.fields,
    fillOnly: { ...note.fillOnly, ...stamp },
    unread: note.unread,
    body,
  };
}

/**
 * The whole run, planned before anything is written: every page's path
 * first, so each relation can be written as a link to the name its note
 * will have, then what to write. A page already in the vault is merged with
 * its note (see `mergeNote`); any other is a new note, unless the record
 * says it was imported and its note has since gone. Only the chosen
 * databases are written, but every one is planned.
 */
export function planWorkspace(input: PlanInput): WorkspacePlan {
  const { candidates, refused, skipped } = candidatesOf(input);
  const places = placesOf(candidates, input);
  const { linkFor, resolve } = linking(candidates, places, input);
  const pages: PagePlan[] = [...refused];
  for (const candidate of candidates.filter(({ database }) => input.selected.has(database.kind))) {
    const named = { database: candidate.database.name, title: candidate.title };
    const place = places.get(candidate.page.id) ?? { kind: 'refused', reason: 'it has no place' };
    if (place.kind === 'refused') {
      pages.push({ kind: 'refused', ...named, reason: place.reason });
      continue;
    }
    if (place.kind === 'deleted') {
      pages.push({ kind: 'deleted', ...named, id: candidate.page.id });
      continue;
    }
    const context = {
      kind: candidate.database.kind,
      columns: candidate.database.csv.columns,
      row: candidate.row,
      resolve,
      statuses: input.statuses,
      today: input.today,
      timeZone: input.timeZone,
    };
    const note = wantedNote(context, candidate.page.id);
    const wanted = wantedContent(note, place.path, bodyOf(candidate, linkFor));
    const placed = {
      ...named,
      id: candidate.page.id,
      path: place.path,
      type: note.place.type,
      notes: [...place.notes, ...note.notes],
    };
    // A note filled in for the first time (a day's own note) is merged as a first import: no record of it applies.
    const last = place.merge === 'recorded' ? (input.record.get(candidate.page.id) ?? null) : null;
    pages.push(
      place.merge === 'none' ? created(placed, wanted) : merged(placed, wanted, { ...input, last }),
    );
  }
  return { pages, skipped };
}

/** The notes the export's pages are already in, by `notion_id` or as a day's note, for the run to read before it plans. */
export function notesToRead(
  input: Pick<PlanInput, 'databases' | 'vault' | 'record' | 'recreateDeleted' | 'timeZone'>,
): VaultPath[] {
  const { candidates } = candidatesOf({ databases: input.databases, selected: new Set() });
  const byId = candidates.flatMap(({ page }) => {
    const found = input.vault.byNotionId.get(page.id) ?? [];
    return found.length === 1 ? found : [];
  });
  return [...new Set([...byId, ...dailyNotesToRead(candidates, input)])];
}

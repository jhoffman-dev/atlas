import {
  cleanEntryName,
  createVaultPath,
  joinFrontmatter,
  linkBreakingCharacter,
  nextAvailableNotePath,
  splitFrontmatter,
  wikiLinkTargetFor,
  type VaultPath,
} from '../../packages/domain/src/index.ts';
import { remarkMarkdown } from '../../packages/adapters/src/index.ts';
import type { ImportRecord } from './import-record.ts';
import { importedAs, mergeNote, type ImportedPage, type WantedContent } from './note-merge.ts';
import type { RelationEntry } from './notion-relations.ts';
import { withWikiLinks } from './page-links.ts';
import { pairRows, type ExportPage, type PairedRow } from './row-pages.ts';
import type { GtdStatus } from './task-status.ts';
import type { VaultNotes } from './vault-notes.ts';
import { readFrontmatter } from './vault-meetings.ts';
import {
  columnsLeftOut,
  placeOf,
  wantedNote,
  type DatabaseKind,
  type NoteKind,
  type ResolvedLink,
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
    } & Placed)
  | ({ readonly kind: 'unchanged'; readonly kept: readonly string[] } & Placed)
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

/** Everything the plan is made from: the export, the vault as read, and how to read tasks. */
export interface PlanInput {
  readonly databases: readonly ExportDatabase[];
  readonly selected: ReadonlySet<DatabaseKind>;
  readonly vault: VaultNotes;
  /** The text of each note a page is already in; null for one that is not UTF-8. */
  readonly texts: ReadonlyMap<VaultPath, string | null>;
  readonly record: ImportRecord;
  readonly statuses: ReadonlyMap<string, GtdStatus>;
  readonly today: string;
}

/** A row of a database this import writes itself, paired with its page. */
interface Candidate {
  readonly database: ExportDatabase & { readonly kind: NoteKind };
  readonly title: string;
  readonly row: ReadonlyMap<string, string>;
  readonly page: ExportPage & { readonly id: string };
}

const writesItself = (database: ExportDatabase): database is Candidate['database'] =>
  database.kind !== null && database.kind !== 'meetings';

/**
 * A title as a note's name that links can reach: `#`, `|`, `^` and brackets
 * are link syntax, so a note named with one could never be linked to.
 */
function linkableName(title: string): string {
  let name = title;
  for (let character = linkBreakingCharacter(name); character !== null;) {
    name = name.replaceAll(character, ' ');
    character = linkBreakingCharacter(name);
  }
  return name;
}

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
function candidatesOf(input: PlanInput) {
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

/**
 * Where every page's note is, or will be: where a note already holds its
 * `notion_id`, or a new path in its database's folder, numbered when the name
 * is taken. Planned for every database in the export, chosen or not, so
 * links to a page this run leaves out still name its note.
 */
function pathsOf(candidates: readonly Candidate[], vault: VaultNotes) {
  const taken = new Set<string>(vault.paths);
  const paths = new Map<string, VaultPath>();
  const conflicts = new Map<string, string>();
  for (const { database, title, row, page } of candidates) {
    const found = vault.byNotionId.get(page.id) ?? [];
    // Two notes claiming one page: neither is a guess to make.
    if (found.length > 1) {
      conflicts.set(page.id, `${found.join(' and ')} all hold its notion_id: merge them first`);
      continue;
    }
    if (found[0] !== undefined) {
      paths.set(page.id, found[0]);
      continue;
    }
    const folder = createVaultPath(
      placeOf({ kind: database.kind, columns: database.csv.columns, row }).folder,
    );
    const path = nextAvailableNotePath({ folder, name: linkableName(title), taken });
    taken.add(path);
    paths.set(page.id, path);
  }
  return { paths, conflicts };
}

/** Links to the notes of the export's pages, by id, else by a title only one page has. */
function linking(
  candidates: readonly Candidate[],
  paths: ReadonlyMap<string, VaultPath>,
  vault: VaultNotes,
) {
  const notes = [...new Set([...vault.paths, ...paths.values()])];
  const targets = new Map<VaultPath, string>();
  const targetOf = (path: VaultPath) => {
    const known = targets.get(path) ?? wikiLinkTargetFor(path, notes);
    targets.set(path, known);
    return known;
  };
  const pathOfId = (id: string) => {
    const existing = vault.byNotionId.get(id);
    return paths.get(id) ?? (existing?.length === 1 ? existing[0] : undefined);
  };
  const byTitle = new Map<string, VaultPath | null>();
  for (const { title, page } of candidates) {
    const path = paths.get(page.id);
    if (path !== undefined) byTitle.set(title, byTitle.has(title) ? null : path);
  }
  const linkFor = (id: string) => {
    const path = pathOfId(id);
    return path === undefined ? null : targetOf(path);
  };
  const resolve = (entry: RelationEntry): ResolvedLink => {
    const path =
      (entry.id === null ? undefined : pathOfId(entry.id)) ?? byTitle.get(entry.title) ?? null;
    if (path !== null) return { link: `[[${targetOf(path)}]]`, known: true };
    const name = cleanEntryName(linkableName(entry.title));
    return { link: `[[${name === '' ? entry.title : name}]]`, known: false };
  };
  return { linkFor, resolve };
}

/** The page's body as a note's: its own words, links to other pages made wiki links, on a line after the properties. */
function bodyOf(page: ExportPage, linkFor: (id: string) => string | null): string {
  const text = withWikiLinks(page.page.body, linkFor).trim();
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
  input: PlanInput,
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
  const merge = mergeNote({
    now: { properties, body },
    wanted,
    last: input.record.get(placed.id) ?? null,
  });
  const after = joinFrontmatter(
    remarkMarkdown.updateFrontmatter(frontmatter, merge.changes),
    merge.body ?? body,
  );
  const changed = [...Object.keys(merge.changes), ...(merge.body === null ? [] : ['body'])];
  const common = { ...placed, kept: merge.kept, imported: merge.imported };
  if (after === text) return { kind: 'unchanged', ...common };
  return { kind: 'update', ...common, before: text, after, changed };
}

/**
 * The whole run, planned before anything is written: every page's path
 * first, so each relation can be written as a link to the name its note
 * will have, then what to write. A page already in the vault is merged with
 * its note (see `mergeNote`); any other is a new note. Only the chosen
 * databases are written, but every one is planned.
 */
export function planWorkspace(input: PlanInput): WorkspacePlan {
  const { candidates, refused, skipped } = candidatesOf(input);
  const { paths, conflicts } = pathsOf(candidates, input.vault);
  const { linkFor, resolve } = linking(candidates, paths, input.vault);
  const pages: PagePlan[] = [...refused];
  for (const candidate of candidates.filter(({ database }) => input.selected.has(database.kind))) {
    const named = { database: candidate.database.name, title: candidate.title };
    const path = paths.get(candidate.page.id);
    if (path === undefined) {
      pages.push({ kind: 'refused', ...named, reason: conflicts.get(candidate.page.id) ?? '' });
      continue;
    }
    const context = {
      kind: candidate.database.kind,
      columns: candidate.database.csv.columns,
      row: candidate.row,
      resolve,
      statuses: input.statuses,
      today: input.today,
    };
    const note = wantedNote(context, candidate.page.id);
    const wanted = {
      fields: note.fields,
      fillOnly: note.fillOnly,
      body: bodyOf(candidate.page, linkFor),
    };
    const placed = { ...named, id: candidate.page.id, path, notes: note.notes };
    pages.push(
      input.vault.byNotionId.has(candidate.page.id)
        ? merged(placed, wanted, input)
        : created(placed, wanted),
    );
  }
  return { pages, skipped };
}

/** The notes the export's pages are already in, for the run to read before it plans. */
export function notesToRead(databases: readonly ExportDatabase[], vault: VaultNotes): VaultPath[] {
  return databases
    .filter(writesItself)
    .flatMap((database) => database.pages)
    .flatMap((page) => {
      const found = page.id === null ? [] : (vault.byNotionId.get(page.id) ?? []);
      return found.length === 1 ? found : [];
    });
}

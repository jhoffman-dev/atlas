import {
  ARCHIVE_DIRECTORY,
  ATLAS_DIRECTORY,
  AUTOMATIONS_DIRECTORY,
  COMPANY_TYPE,
  DASHBOARD_MARKER,
  FILED_UNDER_TYPES,
  foldedLinkName,
  INBOX_DIRECTORY,
  MEETING_TYPE,
  PERSON_TYPE,
  PROJECT_TYPE,
  QUERY_BLOCK_NODE,
  splitWikiLinks,
  TASK_TYPE,
  TERM_TYPE,
  TYPES_DIRECTORY,
  type EditorNode,
  type IndexFacet,
  type NoteChange,
} from '@atlas/domain';

/**
 * What a reader is made from (ADR-0040, #325), so the index's news reads it
 * again only when it touched that: a note at one of `notes`, a note whose name
 * one of `linkedNames` is (a link finds its note by name), a note in one of
 * `folders`, a note of one of `types` — before the change or after it — a
 * note the meeting import brought in (`imports`), or one of `facets` changed.
 * `anyNote` is a reader any note can move: a query of the whole vault.
 */
export interface ReadScope {
  readonly notes?: readonly string[];
  readonly linkedNames?: readonly string[];
  readonly folders?: readonly string[];
  readonly types?: readonly string[];
  readonly imports?: true;
  readonly facets?: readonly IndexFacet[];
  readonly anyNote?: true;
}

/**
 * What the Inbox lists (`listInbox`): every note in the Inbox folder, the
 * proposals in it included, tasks that start there wherever they are, and the
 * meetings the import brought in until they are filed (#214) — and so the
 * summaries it says are pending (#186). Also the notes its rows' pickers
 * resolve to — the projects and areas a row is filed under, the people a task
 * waits on: moving one re-resolves the row's relation in the index without
 * changing the row's own text, so no news names the row (#390).
 *
 * Not covered: a relation a row resolves to a note of another type, or of
 * none — `waiting_on: [[Acme]]` naming a company or an untyped note. Its move
 * or retitle reaches no covered note; the row is right again on the next news
 * the Inbox hears (#392).
 */
export const INBOX_SCOPE: ReadScope = {
  folders: [INBOX_DIRECTORY],
  types: [TASK_TYPE, MEETING_TYPE, ...FILED_UNDER_TYPES, PERSON_TYPE],
  imports: true,
};

/**
 * What Today and the weekly review read (`readReviewSources`): the tasks, the
 * notes they are filed under, whose titles head their groups — the filed-under
 * types (project, area) — and the Inbox's count.
 *
 * Not covered: a `project:` link a task resolves to a note of no filed-under
 * type (an untyped note). Today covers it by `todayScope`, from what it read
 * (#392); the weekly review heads no group with it.
 */
export const REVIEW_SCOPE: ReadScope = {
  ...INBOX_SCOPE,
  types: [TASK_TYPE, MEETING_TYPE, ...FILED_UNDER_TYPES],
};

/** What the Inbox files under and says a task waits on: the projects and areas, and the people. */
export const INBOX_CHOICES_SCOPE: ReadScope = {
  types: [...FILED_UNDER_TYPES, PERSON_TYPE],
};

/** The vault's people, as `@` offers them (`loadPeople`). */
export const PEOPLE_SCOPE: ReadScope = { types: [PERSON_TYPE] };

/** The projects an artifact can belong to (`notesInUseOfType`). */
export const PROJECTS_SCOPE: ReadScope = { types: [PROJECT_TYPE] };

/** The owner's own addresses on their Person note, read from the people and companies (`suggestSelfEmails`). */
export const PERSON_EMAILS_SCOPE: ReadScope = { types: [PERSON_TYPE, COMPANY_TYPE] };

/** A note's unlinked mentions: any note's words can name it. */
export const MENTIONS_SCOPE: ReadScope = { anyNote: true };

/**
 * What sync counts as an edit to send (#326): any note changed. A file the
 * index does not hold is news whose notes are not known, which reaches every
 * reader, this one too, so no change to the vault goes uncounted.
 */
export const SYNC_SCOPE: ReadScope = { anyNote: true };

/**
 * What the Automations page lists while it is open (`loadAutomations`): the
 * rule files and their logs, which are read from the files and not the index.
 * What sets a rule off is not this: that is every sync's `NoteChanges`.
 */
export const AUTOMATIONS_SCOPE: ReadScope = { folders: [AUTOMATIONS_DIRECTORY] };

/** The sources that name a secret (`listSecrets`): any note can be one. */
export const SECRETS_SCOPE: ReadScope = { anyNote: true };

/**
 * What the Archive lists (`listArchive`): every note in the Archive folder,
 * and the projects whose `para` is archive (ADR-0037) — so a project's change
 * reads it again whether it was archived or brought back (#327).
 */
export const ARCHIVE_SCOPE: ReadScope = {
  folders: [ARCHIVE_DIRECTORY],
  types: [PROJECT_TYPE],
};

/**
 * What the Terms page lists (`loadTerms`): the terms, and the people and
 * companies whose names and other spellings the vocabulary is made of.
 */
export const TERMS_SCOPE: ReadScope = { types: [TERM_TYPE, PERSON_TYPE, COMPANY_TYPE] };

/**
 * What a type's table lists (`typeTableQuery`): its notes, whose own
 * properties are its columns, and the type files, whose properties the
 * index's view of the type is built from.
 */
export function typeTableScope(typeName: string): ReadScope {
  return { types: [typeName], folders: [TYPES_DIRECTORY] };
}

/** What the tags page lists for the chosen tag (`loadTaggedNotes`): any note can take a tag. */
export const TAGS_SCOPE: ReadScope = { anyNote: true };

/**
 * The query page (`useQueryPage`): a query of the whole vault. Its schema is
 * read with it; a views rebuild alone tells no news, so it does not move it.
 */
export const QUERY_SCOPE: ReadScope = { anyNote: true };

/** The rule editor's "which notes" builder: a query of the whole vault, as the query page's. */
export const RULE_QUERY_SCOPE: ReadScope = { anyNote: true };

/** The search palette's hits (`searchNotes`): any note can match. */
export const SEARCH_SCOPE: ReadScope = { anyNote: true };

/**
 * What the index had to say when it last had news for its readers: the notes
 * its syncs found added, changed or removed since its news before, or null
 * when that is not known — a build, a failure, or a refresh that moved it
 * without finding a note changed (a file the index does not hold was) — and
 * the facets its writes changed.
 */
export interface IndexNews {
  readonly changes: readonly NoteChange[] | null;
  readonly facets: ReadonlySet<IndexFacet>;
}

/** Any reader is read again: what changed is not known. */
export const UNKNOWN_NEWS: IndexNews = { changes: null, facets: new Set() };

/** A name as the Mac's disk reads it, and as a link finds a note by it: case aside. */
const folded = (name: string) => name.trim().normalize('NFC').toLowerCase();

/**
 * The name a note goes by in a link, as the link resolver compares it
 * (`foldedLinkName`: extension dropped, accents composed, case folded): the
 * last part of a path or of a link written by path. Both sides of a match are
 * spelled by it, so a file named in one Unicode form and a link typed in the
 * other still meet (A21-02).
 */
function nameOf(pathOrTarget: string): string {
  return foldedLinkName(pathOrTarget.slice(pathOrTarget.lastIndexOf('/') + 1));
}

/**
 * Each type a change's note declared, then or now. A note that declares two
 * (`type: [task, project]`) is read as their names joined by commas, as
 * `noteTypeName` spells it.
 */
function typesOf(change: NoteChange): string[] {
  const declared = [change.type, change.beforeType ?? null].filter(
    (type): type is string => type !== null,
  );
  return declared.flatMap((type) => type.split(',')).map(folded);
}

function within(path: string, folder: string): boolean {
  const at = folded(path).replace(/\/+$/, '');
  const holder = folded(folder).replace(/\/+$/, '');
  return at === holder || at.startsWith(`${holder}/`);
}

/** Whether one note's change reaches a reader made from `scope`. */
function changeTouches(scope: ReadScope, change: NoteChange): boolean {
  if (scope.anyNote === true) return true;
  const path = folded(change.path);
  if (scope.notes?.some((note) => folded(note) === path) === true) return true;
  if (scope.linkedNames?.some((name) => nameOf(name) === nameOf(change.path)) === true) return true;
  if (scope.folders?.some((folder) => within(change.path, folder)) === true) return true;
  if (scope.imports === true && imported(change)) return true;
  const types = new Set(scope.types?.map(folded));
  return typesOf(change).some((type) => types.has(type));
}

/** A note the meeting import brought in, or settled, before the change or after it. */
function imported(change: NoteChange): boolean {
  return (
    change.importDeclared === true ||
    change.importOutcome !== undefined ||
    change.beforeImportOutcome !== undefined
  );
}

/**
 * Whether the index's news reaches a reader made from `scope`. When unsure,
 * it does: news whose notes are not known reads every reader again.
 */
export function scopeTouched(scope: ReadScope, news: IndexNews): boolean {
  if (news.changes === null) return true;
  if (scope.facets?.some((facet) => news.facets.has(facet)) === true) return true;
  return news.changes.some((change) => changeTouches(scope, change));
}

/** The note a pane shows, as it was read (`OpenNote`): what its readers are made from. */
export interface PaneNote {
  readonly path: string;
  readonly frontmatter: string | null;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly originalBody: string;
  readonly doc: { readonly content: readonly EditorNode[] };
}

/** Whether a query block (P30-05) is anywhere in the note: it answers a query of the vault. */
function holdsQueryBlock(nodes: readonly EditorNode[]): boolean {
  return nodes.some(
    (node) => node.type === QUERY_BLOCK_NODE || holdsQueryBlock(node.content ?? []),
  );
}

/** The names of the notes `text` links to, embeds included. */
function linkedNamesIn(text: string): string[] {
  return splitWikiLinks(text).flatMap((piece) =>
    piece.kind === 'wikiLink' ? [nameOf(piece.target)] : [],
  );
}

/**
 * What a note's pane is made from. A plain note — no type, no view or
 * dashboard, none of Atlas's own, no query block — shows itself, the notes it
 * links to or embeds (their cards and blocks), and its links both ways (the
 * graph). Anything else shows answers about other notes — a type's linked
 * sections, a view's rows, a dashboard's widgets, a task's time blocks, a
 * query block's rows — that any note can move, so any note's change reads it
 * again, as every one did before (#325).
 */
export function notePaneScope(note: PaneNote | null, path: string): ReadScope {
  if (note === null) return { notes: [path], facets: ['graph'] };
  const typed = note.properties['type'] !== undefined && note.properties['type'] !== null;
  const marked = note.properties[DASHBOARD_MARKER] !== undefined;
  const atlas = within(note.path, ATLAS_DIRECTORY);
  if (typed || marked || atlas || holdsQueryBlock(note.doc.content)) return { anyNote: true };
  const linkedNames = [
    ...new Set([...linkedNamesIn(note.frontmatter ?? ''), ...linkedNamesIn(note.originalBody)]),
  ];
  return { notes: [note.path], linkedNames, facets: ['graph'] };
}

import type { NoteVersion, VaultPath } from '@atlas/domain';

/** One column of a type's SQL view. */
export interface ViewColumnSpec {
  readonly key: string;
  readonly kind: string;
  readonly many: boolean;
}

export interface ViewTypeSpec {
  readonly name: string;
  readonly columns: readonly ViewColumnSpec[];
}

export interface QueryResult {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
  /** True when the row cap stopped the result short. */
  readonly truncated: boolean;
}

/**
 * What the index knows about a file: enough to tell whether it needs reading
 * again, and — its version — whether its text changed and what it was (P28-03).
 */
export interface IndexEntry extends NoteVersion {
  readonly path: string;
  readonly modified: number;
  readonly size: number;
}

export interface IndexedLinkRow {
  /** The link exactly as written. */
  readonly target: string;
  /** The note it resolves to, or null when it points nowhere yet. */
  readonly path: string | null;
  readonly kind: 'wikilink' | 'markdown';
}

export interface IndexedNote extends NoteVersion {
  readonly path: string;
  readonly title: string;
  readonly modified: number;
  readonly size: number;
  /** Words with the markup removed, for searching. */
  readonly body: string;
  /** The opening line, for showing what a note is about without opening it. */
  readonly summary: string;
  readonly properties: readonly {
    readonly key: string;
    readonly index: number;
    readonly text: string | null;
    readonly number: number | null;
    readonly date: string | null;
    readonly json: string | null;
  }[];
  readonly links: readonly IndexedLinkRow[];
  /** Every use of a tag, frontmatter first, in the order written. */
  readonly tags: readonly IndexedTagRow[];
  /** Every link a property holds, resolved here so the host only stores it (ADR-0019). */
  readonly relations: readonly IndexedRelationRow[];
  /** Every block with an id (P26-01), read here so the host only stores it. */
  readonly blocks: readonly IndexedBlockRow[];
}

/** A block a `#^id` can name: its id, and a line of what it says. */
export interface IndexedBlockRow {
  readonly id: string;
  readonly text: string;
}

export interface IndexedRelationRow {
  readonly key: string;
  readonly index: number;
  /** The link's target as written. */
  readonly target: string;
  /** The target as links compare it loosely — composed, no extension, case folded. */
  readonly name: string;
  /** The note it resolves to, or null when it points nowhere yet. */
  readonly path: string | null;
}

export interface IndexedTagRow {
  /** What makes it the same tag as another, case aside. */
  readonly key: string;
  /** As written here. */
  readonly name: string;
}

export interface SearchHit {
  readonly path: string;
  readonly title: string;
  /** The matching text with `<<` and `>>` around the words that matched. */
  readonly snippet: string;
}

/**
 * Which notes a search leaves out, by where they are. The host is handed the
 * prefix and obeys it; which prefix, and when, is decided here (ADR-0014).
 */
export interface SearchScope {
  /** Notes whose path starts with this, compared in lower case, are not searched. */
  readonly skipPrefix?: string;
}

export interface IndexStats {
  readonly notes: number;
  readonly properties: number;
  readonly links: number;
}

/**
 * The derived index. Everything in it restates what the markdown files already
 * say, so it can be thrown away and rebuilt at any time.
 */
/** What opening the index found. */
export interface IndexOpening {
  /**
   * True when the host made the index just now — there was none, or it threw
   * away one of an older shape — so it holds nothing of the vault yet.
   */
  readonly fresh: boolean;
}

export interface IndexPort {
  open(): Promise<IndexOpening>;
  clear(): Promise<void>;
  manifest(): Promise<readonly IndexEntry[]>;
  put(notes: readonly IndexedNote[]): Promise<void>;
  remove(paths: readonly VaultPath[]): Promise<void>;
  search(query: string, limit: number, scope?: SearchScope): Promise<readonly SearchHit[]>;
  /** Notes whose frontmatter declares this type — what a relation may point at. */
  notesOfType(type: string): Promise<readonly { path: string; title: string }[]>;
  /** Rebuilds the SQL view behind each type, after a type definition changes. */
  rebuildViews(types: readonly ViewTypeSpec[]): Promise<void>;
  /** Runs a query on a read-only connection. Cannot change anything. */
  query(sql: string, parameters: readonly (string | number | null)[]): Promise<QueryResult>;
  backlinks(path: VaultPath): Promise<readonly string[]>;
  stats(): Promise<IndexStats>;
}

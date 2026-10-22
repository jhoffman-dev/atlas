import { foldedLinkName } from '../markdown/resolve-wikilink.ts';
import { splitWikiLinks } from '../markdown/wikilink.ts';
import type { CompiledQuery } from '../query/view-query.ts';

/**
 * A property that points at another note, for the index's `relations` table.
 *
 * Resolving the link is done here, in TypeScript, with the same rule every
 * link in the app is resolved by — the host only stores the answer
 * (ADR-0005). That is what lets a query follow `project.owner` with a join
 * instead of re-deciding in SQL which note `[[DFAI]]` means (ADR-0019).
 */
export interface IndexableRelation {
  readonly key: string;
  /** The item's place in a list, as the properties table numbers it; 0 for one value. */
  readonly index: number;
  /** The link's target as written: `DFAI` for `[[DFAI|the app]]`. */
  readonly target: string;
  /** The target as links compare it loosely ({@link foldedLinkName}): `atlas` for `DFAI.md`. */
  readonly name: string;
  /** The note it resolves to, or null when it points nowhere yet. */
  readonly path: string | null;
}

/** `type` names what a note is, not a note it points at — as the graph reads it. */
const NOT_A_RELATION = 'type';

/** Every link held in a note's frontmatter, with where each one resolves. */
export function relationsOf(
  frontmatter: Readonly<Record<string, unknown>>,
  resolve: (target: string) => string | null,
): IndexableRelation[] {
  return Object.entries(frontmatter).flatMap(([key, value]) => {
    if (key === NOT_A_RELATION) return [];
    const items = Array.isArray(value) ? value : [value];
    return items.flatMap((item: unknown, index) =>
      typeof item === 'string'
        ? linkTargets(item).map((target) => ({
            key,
            index,
            target,
            name: foldedLinkName(target),
            path: resolve(target),
          }))
        : [],
    );
  });
}

/** How many notes one question about stale links carries, well inside SQLite's limit. */
export const LINK_NAMES_PER_QUERY = 200;

/** The notes that have just been made or have gone, by path, for {@link compileLinkHoldersQuery}. */
export interface LinkChanges {
  readonly made: readonly string[];
  readonly gone: readonly string[];
}

/**
 * The notes holding a link whose target could now mean another note — in a
 * property (`relations`) or in the body (`links`, #431). The index resolved
 * them when they were written; these must be read again for the answer to be
 * true now.
 *
 * A link could move to a note just made when it is written as that note's
 * name (`[[Later]]` or `[[p/Later]]` for `Later.md`) and does not already
 * point at it: a note let go of and taken back (`forgetNotes`) was already
 * the answer, so the notes linking to it are not read again (#440). A link
 * moves off a note gone only when it pointed at that note.
 *
 * Columns: path, in order, from `offset` on — the host cuts a long answer
 * short, so the caller asks again from where it stopped. Every value is bound.
 */
export function compileLinkHoldersQuery({ made, gone }: LinkChanges, offset = 0): CompiledQuery {
  // The stored name is folded in TypeScript: SQLite's lower() knows only ASCII.
  const madeRelation =
    '((name = ? OR substr(name, -length(?) - 1) = ?) AND (dst IS NULL OR dst <> ?))';
  // A body link keeps its name's last part (`leaf`), indexed, so this is a lookup, not a scan.
  const madeLink = '(leaf = ? AND (dst IS NULL OR dst <> ?))';
  const goneTests = gone.length === 0 ? [] : [`dst IN (${gone.map(() => '?').join(', ')})`];
  const where = (test: string) => [...made.map(() => test), ...goneTests].join(' OR ') || '0';
  const names = made.map((path) => [linkedName(path), path] as const);
  return {
    sql:
      `SELECT DISTINCT src AS "path" FROM relations WHERE ${where(madeRelation)}` +
      ` UNION SELECT src FROM links WHERE ${where(madeLink)} ORDER BY 1 LIMIT -1 OFFSET ?`,
    parameters: [
      ...names.flatMap(([name, path]) => [name, name, `/${name}`, path]),
      ...gone,
      ...names.flatMap(([name, path]) => [name, path]),
      ...gone,
      offset,
    ],
  };
}

/** A note's name as a link names it, for {@link compileLinkHoldersQuery}. */
export function linkedName(path: string): string {
  return foldedLinkName(path.split('/').at(-1) ?? path);
}

/**
 * The last part of a link's folded target — `later` for `[[p/Later]]` — which
 * is the {@link linkedName} of every note it could mean: kept with a body link
 * so the notes linking to a name are found by an index.
 */
export function linkLeaf(target: string): string {
  return foldedLinkName(target).split('/').at(-1) ?? '';
}

export function linkTargets(text: string): string[] {
  return splitWikiLinks(text.trim()).flatMap((piece) =>
    // Trimmed as a query's link is, so `[[ Nowhere ]]` is written the same way as `[[Nowhere]]`.
    piece.kind === 'wikiLink' ? [piece.target.trim()] : [],
  );
}

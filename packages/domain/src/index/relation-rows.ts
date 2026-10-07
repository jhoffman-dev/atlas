import { foldedLinkName } from '../markdown/resolve-wikilink.ts';
import { splitWikiLinks } from '../markdown/wikilink.ts';
import type { CompiledQuery } from '../query/view-query.ts';

/**
 * A property that points at another note, for the index's `relations` table.
 *
 * Resolving the link is done here, in TypeScript, with the same rule every
 * link in the app is resolved by — the host only stores the answer
 * (ADR-0005). That is what lets a query follow `project.owner` with a join
 * instead of re-deciding in SQL which note `[[Atlas]]` means (ADR-0019).
 */
export interface IndexableRelation {
  readonly key: string;
  /** The item's place in a list, as the properties table numbers it; 0 for one value. */
  readonly index: number;
  /** The link's target as written: `Atlas` for `[[Atlas|the app]]`. */
  readonly target: string;
  /** The target as links compare it loosely ({@link foldedLinkName}): `atlas` for `Atlas.md`. */
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

/** How many names one question about stale relations carries, well inside SQLite's limit. */
export const RELATION_NAMES_PER_QUERY = 200;

/**
 * The notes holding a relation whose target could now mean another note: one
 * written as any of these names — each the name, folded as links fold it, of a
 * note that has just been made or has gone. `[[Later]]` and `[[p/Later]]` both qualify
 * for `later`. The index resolved them when they were written; these must be
 * read again for the answer to be true now. Columns: path. Every name is bound.
 */
export function compileRelationHoldersQuery(names: readonly string[]): CompiledQuery {
  // The stored name is folded in TypeScript: SQLite's lower() knows only ASCII.
  const test = '(name = ? OR substr(name, -length(?) - 1) = ?)';
  return {
    sql: `SELECT DISTINCT src AS "path" FROM relations WHERE ${names.map(() => test).join(' OR ')}`,
    parameters: names.flatMap((name) => [name, name, `/${name}`]),
  };
}

/** A note's name as a link names it, for {@link compileRelationHoldersQuery}. */
export function linkedName(path: string): string {
  return foldedLinkName(path.split('/').at(-1) ?? path);
}

function linkTargets(text: string): string[] {
  return splitWikiLinks(text.trim()).flatMap((piece) =>
    // Trimmed as a query's link is, so `[[ Nowhere ]]` is written the same way as `[[Nowhere]]`.
    piece.kind === 'wikiLink' ? [piece.target.trim()] : [],
  );
}

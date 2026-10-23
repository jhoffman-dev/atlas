import { linkFragment } from '../markdown/link-fragment.ts';
import { createWikiLinkResolver, wikiLinkTargetWith } from '../markdown/resolve-wikilink.ts';
import { readWikiLink } from '../markdown/wikilink-spans.ts';
import type { VaultPath } from '../vault/vault-path.ts';

/*
 * Every item the assistant's tools answer with says where it came from (PLAN
 * §11, principle 3): a link that opens the note, the heading or the block it
 * was read from, written as a person would write it in a note (ADR-0022).
 *
 * The tools only read. A transcript turn the file left without a `^id` is
 * cited by the Transcript heading it sits under — never given an id, since an
 * id is written only by the person who first links to a block (ADR-0022) —
 * and its `kind` says the link is that much less exact.
 */

/** How exactly a citation names what it cites: the block itself, the heading over it, or the note. */
export type CitationKind = 'block' | 'heading' | 'note';

export interface Citation {
  /**
   * A wiki link, `[[Kickoff#^t0003]]`, that opens what is cited. Null when the
   * note's name holds what a link cannot (`[ ] | #`, as `C# sync`): no link
   * could open it, so it is cited by its `path` alone.
   */
  readonly link: string | null;
  readonly kind: CitationKind;
  /** The note it opens, or null for a link that names no note in the vault. */
  readonly path: string | null;
}

/** What goes inside `[[…]]` to open a note among the vault's notes: its name, or its path when the name is shared. */
export type LinkTargetOf = (path: VaultPath) => string;

/** The heading a meeting's turns are written under (`## Transcript`). */
export const TRANSCRIPT_HEADING = 'Transcript';

/** How one answer's links are written and read: built once for every item of it. */
export interface Linking {
  readonly targetOf: LinkTargetOf;
  /** The note a link's target opens, or null for none. */
  readonly resolve: (target: string) => VaultPath | null;
}

/** {@link Linking} among one set of notes, the resolver built once. */
export function linkingAmong(notePaths: readonly VaultPath[]): Linking {
  const resolve = createWikiLinkResolver(notePaths);
  return { resolve, targetOf: (path) => wikiLinkTargetWith(path, resolve) };
}

/** What a link's target cannot hold: its own syntax, which a link to such a name would be cut at. */
const UNLINKABLE_TARGET = /[#[\]|]/;

/** A whole note. */
export function noteCitation(path: VaultPath, targetOf: LinkTargetOf): Citation {
  const target = targetOf(path);
  const link = UNLINKABLE_TARGET.test(target) ? null : `[[${target}]]`;
  return { link, kind: 'note', path };
}

/**
 * One turn of a meeting: its block when it has an id, else the Transcript
 * heading over it. A meeting whose name no link can hold is cited as a note.
 */
export function turnCitation(
  path: VaultPath,
  blockId: string | null,
  targetOf: LinkTargetOf,
): Citation {
  const target = targetOf(path);
  if (UNLINKABLE_TARGET.test(target)) return noteCitation(path, targetOf);
  return blockId === null
    ? { link: `[[${target}#${TRANSCRIPT_HEADING}]]`, kind: 'heading', path }
    : { link: `[[${target}#^${blockId}]]`, kind: 'block', path };
}

/** The block a `source` link names, and the note it is in. */
export interface BlockRef {
  readonly path: VaultPath;
  readonly id: string;
}

/** The one wiki link a `source` is written as, or null when it is not exactly one. */
function sourceLink(source: unknown) {
  if (typeof source !== 'string') return null;
  const link = readWikiLink(source.trim());
  return link === null || link.embed ? null : link;
}

/**
 * The block a `source` names, when it names one of a note the vault holds:
 * what the index is asked whether it still has.
 */
export function sourceBlockOf(
  source: unknown,
  resolve: (target: string) => VaultPath | null,
): BlockRef | null {
  const link = sourceLink(source);
  const fragment = link === null ? null : linkFragment(link);
  const path = link === null ? null : resolve(link.target);
  return fragment?.kind === 'block' && path !== null ? { path, id: fragment.id } : null;
}

/**
 * Where a task or a decision says it came from: its `source`, when that is
 * one wiki link — as an accepted proposal writes it, `[[Kickoff#^t0003]]` —
 * written back without any alias. Null for no source, or one that is not a
 * link. A block the index no longer holds (`isBlock` says no) is cited as
 * its note: a link to a block that is gone opens nothing, and `kind: "block"`
 * would promise the quote is there.
 */
export function sourceCitation(
  source: unknown,
  resolve: (target: string) => VaultPath | null,
  isBlock: (block: BlockRef) => boolean = () => true,
): Citation | null {
  const link = sourceLink(source);
  if (link === null) return null;
  const fragment = linkFragment(link);
  const path = resolve(link.target);
  const gone = fragment?.kind === 'block' && (path === null || !isBlock({ path, id: fragment.id }));
  if (fragment === null || gone) return { link: `[[${link.target}]]`, kind: 'note', path };
  return { link: `[[${link.target}${link.heading ?? ''}]]`, kind: fragment.kind, path };
}

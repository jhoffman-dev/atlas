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
  /** A wiki link, `[[Kickoff#^t0003]]`, that opens what is cited. */
  readonly link: string;
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

/** A whole note. */
export function noteCitation(path: VaultPath, targetOf: LinkTargetOf): Citation {
  return { link: `[[${targetOf(path)}]]`, kind: 'note', path };
}

/** One turn of a meeting: its block when it has an id, else the Transcript heading over it. */
export function turnCitation(
  path: VaultPath,
  blockId: string | null,
  targetOf: LinkTargetOf,
): Citation {
  const target = targetOf(path);
  return blockId === null
    ? { link: `[[${target}#${TRANSCRIPT_HEADING}]]`, kind: 'heading', path }
    : { link: `[[${target}#^${blockId}]]`, kind: 'block', path };
}

/**
 * Where a task or a decision says it came from: its `source`, when that is
 * one wiki link — as an accepted proposal writes it, `[[Kickoff#^t0003]]` —
 * written back without any alias. Null for no source, or one that is not a
 * link. Whether the block is still there is not checked here; opening the
 * link says.
 */
export function sourceCitation(
  source: unknown,
  resolve: (target: string) => VaultPath | null,
): Citation | null {
  if (typeof source !== 'string') return null;
  const link = readWikiLink(source.trim());
  if (link === null || link.embed) return null;
  const fragment = linkFragment(link);
  const kind: CitationKind = fragment === null ? 'note' : fragment.kind;
  const after = fragment === null ? '' : (link.heading ?? '');
  return { link: `[[${link.target}${after}]]`, kind, path: resolve(link.target) };
}

import {
  highlightKey,
  sameKindlePlace,
  type HighlightAnchor,
  type KindleAnchor,
} from './anchor.ts';

/*
 * Which passage each highlight of one append is (ADR-0043 §7): one the note
 * already holds, or one the append writes. A passage is found by
 * `highlightKey`; a Kindle one also by its place and words
 * (`sameKindlePlace`), for an export that has an annotation id the copy
 * synced earlier lacked (or the reverse), or places the passage differently.
 *
 * Being the same place is not transitive — a copy with only a page is the
 * same place as two copies at different locations on that page, which are
 * not the same place as each other — so a highlight joins a passage only
 * when it is the same place as every highlight already in it, and two with
 * different annotation ids are never one passage. Two blocks the note holds
 * are never one passage either.
 *
 * The held blocks are matched as if they were highlights of the append:
 * every key — of a held block, an incoming highlight, or both — is placed
 * in one order, whatever order the export lists them in and whichever of
 * them the note already holds: those with a location, each joining a
 * passage with a location before one with a page alone, so a location match
 * is taken before a page match; then those with a page alone; among each, by
 * key. A passage with a held block in it answers that block; one without is
 * written. A block a sync wrote has the key of the highlight it was written
 * from, so a sync run again places the same keys in the same order, finds
 * the same passages, and each of them now holds its block: it adds nothing.
 */

/** A highlight of the append, as matching reads it. */
export interface PassageCandidate {
  /** Its anchor, a Kindle one with the export's words as `exact`. */
  readonly anchor: HighlightAnchor;
  readonly quote: string;
  /** Everything the highlight would write, so the one written of two with one key does not hang on their order. */
  readonly tieBreak: string;
}

/** A highlight the note holds. */
export interface HeldPassage {
  readonly id: string;
  readonly anchor: HighlightAnchor;
  readonly quote: string;
}

/** A highlight's passage: one the note holds, by its id, or the one the highlight at `writer` writes. */
export type PassageMatch = { readonly held: string } | { readonly writer: number };

interface Passage {
  /** The held block it answers, once one joins it. */
  held: string | undefined;
  /** The highlight written for it when no held block joins it: that of the key that began it. */
  readonly writer: number | undefined;
  readonly kindle: { anchor: KindleAnchor; quote: string }[];
}

/** The held blocks and highlights of the append that share a key, read as one. */
interface KeyGroup {
  readonly key: string;
  /** The held blocks with this key, in the note's order. */
  readonly held: readonly HeldPassage[];
  /** The highlights of the append with this key, by index. */
  readonly members: readonly number[];
  /** Of `members`, the one written, by what it writes; none when there are none. */
  readonly writer: number | undefined;
  /** Where the key is placed: as the note holds it, else as it would be written. */
  readonly placed: HighlightAnchor;
}

/** Each candidate's passage, by index. */
export function matchPassages(
  held: readonly HeldPassage[],
  candidates: readonly PassageCandidate[],
): PassageMatch[] {
  const passages: Passage[] = [];
  const passageOf = new Array<Passage>(candidates.length);
  for (const group of orderForClaim(keyGroups(held, candidates))) {
    const own = kindleOf([
      ...group.held,
      ...group.members.map((at) => candidates[at] as PassageCandidate),
    ]);
    const joinable =
      group.held.length === 0 ? passages : passages.filter((other) => other.held === undefined);
    let passage = own.length === 0 ? undefined : placedAlike(joinable, own);
    if (passage === undefined) {
      passage = { held: undefined, writer: group.writer, kindle: [] };
      passages.push(passage);
    }
    passage.kindle.push(...own);
    passage.held ??= group.held[0]?.id;
    for (const at of group.members) passageOf[at] = passage;
  }
  return passageOf.map(answerOf);
}

/** A passage a held block joined answers it; any other was begun by a key with a highlight to write. */
function answerOf(passage: Passage): PassageMatch {
  if (passage.held !== undefined) return { held: passage.held };
  // A key with no highlight of the append has a held block, which `held` names.
  return { writer: passage.writer as number };
}

/**
 * The groups placed at a location first, so a location match is taken before
 * a page match. A key is placed as the note holds it, so whether a sync is
 * handed a copy of it with a location never moves it.
 */
function orderForClaim(groups: readonly KeyGroup[]): KeyGroup[] {
  const located = (group: KeyGroup) => isLocated(group.placed);
  return [...groups.filter(located), ...groups.filter((group) => !located(group))];
}

const isLocated = (anchor: HighlightAnchor): boolean =>
  anchor.kind === 'kindle' && anchor.location !== null;

/**
 * The held blocks and candidates grouped by key, in the order of their keys
 * whatever the candidates' order, each written from the first of its
 * candidates by what it writes.
 */
function keyGroups(
  held: readonly HeldPassage[],
  candidates: readonly PassageCandidate[],
): KeyGroup[] {
  const byKey = new Map<string, { held: HeldPassage[]; members: number[] }>();
  const groupOf = (key: string) => {
    const group = byKey.get(key) ?? { held: [], members: [] };
    byKey.set(key, group);
    return group;
  };
  for (const passage of held) {
    groupOf(highlightKey(passage.anchor, passage.quote)).held.push(passage);
  }
  candidates.forEach((candidate, at) => {
    groupOf(highlightKey(candidate.anchor, candidate.quote)).members.push(at);
  });
  const tieBreakOf = (at: number) => (candidates[at] as PassageCandidate).tieBreak;
  return [...byKey.entries()]
    .map(([key, group]): KeyGroup => {
      const [writer] = [...group.members].sort((a, b) => compare(tieBreakOf(a), tieBreakOf(b)));
      // Every key has a held block or a highlight of the append, so one of them places it.
      const placed = (group.held[0] ?? candidates[writer as number]) as { anchor: HighlightAnchor };
      return { key, ...group, writer, placed: placed.anchor };
    })
    .sort((a, b) => compare(a.key, b.key));
}

/**
 * The first passage every Kindle copy of which is the same place as every one
 * of `own`, with no two annotation ids: a passage with a location before one
 * with a page alone, so a location match is taken before a page match.
 */
function placedAlike(
  passages: readonly Passage[],
  own: readonly { anchor: KindleAnchor; quote: string }[],
): Passage | undefined {
  const alike = passages.filter(
    (passage) =>
      passage.kindle.length > 0 &&
      passage.kindle.every((held) => own.every((copy) => samePassage(copy, held))),
  );
  const locatedOwn = own.some((copy) => isLocated(copy.anchor));
  const byLocation = alike.find(
    (passage) => locatedOwn && passage.kindle.some((held) => isLocated(held.anchor)),
  );
  return byLocation ?? alike[0];
}

function samePassage(
  a: { anchor: KindleAnchor; quote: string },
  b: { anchor: KindleAnchor; quote: string },
): boolean {
  const ids = [a.anchor.annotationId, b.anchor.annotationId];
  if (ids[0] !== null && ids[1] !== null && ids[0] !== ids[1]) return false;
  return sameKindlePlace(a, b);
}

function kindleOf(
  highlights: readonly { anchor: HighlightAnchor; quote: string }[],
): { anchor: KindleAnchor; quote: string }[] {
  return highlights.flatMap(({ anchor, quote }) =>
    anchor.kind === 'kindle' ? [{ anchor, quote }] : [],
  );
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

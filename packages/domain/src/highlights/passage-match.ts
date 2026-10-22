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
 * different annotation ids are never one passage. Which joins which is
 * decided in one order, whatever order the export lists them in: a
 * highlight its key (an annotation id, or a place and words) finds first;
 * then those with a location, each joining a passage with a location before
 * one with a page alone, so a location match is taken before a page match;
 * then those with a page alone; among each, by key.
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
  readonly match: PassageMatch;
  readonly kindle: { anchor: KindleAnchor; quote: string }[];
}

/** The highlights of the append that share a key, read as one, and the one of them written. */
interface KeyGroup {
  readonly key: string;
  readonly members: readonly number[];
  readonly writer: number;
}

/** Each candidate's passage, by index. */
export function matchPassages(
  held: readonly HeldPassage[],
  candidates: readonly PassageCandidate[],
): PassageMatch[] {
  const passages = held.map((passage): Passage => ({
    match: { held: passage.id },
    kindle: kindleOf([passage]),
  }));
  const heldByKey = firstByKey(held, passages);
  const answer = new Array<PassageMatch>(candidates.length);
  const assign = (group: KeyGroup, passage: Passage) => {
    passage.kindle.push(...kindleOf(group.members.map((at) => candidates[at] as PassageCandidate)));
    for (const at of group.members) answer[at] = passage.match;
  };
  const unmatched: KeyGroup[] = [];
  for (const group of keyGroups(candidates)) {
    const passage = heldByKey.get(group.key);
    if (passage === undefined) unmatched.push(group);
    else assign(group, passage);
  }
  for (const group of orderForClaim(unmatched, candidates)) {
    const own = kindleOf(group.members.map((at) => candidates[at] as PassageCandidate));
    const joined = own.length === 0 ? undefined : placedAlike(passages, own);
    if (joined !== undefined) assign(group, joined);
    else {
      const passage: Passage = { match: { writer: group.writer }, kindle: [] };
      passages.push(passage);
      assign(group, passage);
    }
  }
  return answer;
}

/** The groups with a location first, so a location match is taken before a page match. */
function orderForClaim(
  groups: readonly KeyGroup[],
  candidates: readonly PassageCandidate[],
): KeyGroup[] {
  const located = (group: KeyGroup) =>
    group.members.some((at) => isLocated((candidates[at] as PassageCandidate).anchor));
  return [...groups.filter(located), ...groups.filter((group) => !located(group))];
}

/** Each held passage by its key; of two with one key, the first in the note. */
function firstByKey(
  held: readonly HeldPassage[],
  passages: readonly Passage[],
): Map<string, Passage> {
  const byKey = new Map<string, Passage>();
  held.forEach((passage, at) => {
    const key = highlightKey(passage.anchor, passage.quote);
    if (!byKey.has(key)) byKey.set(key, passages[at] as Passage);
  });
  return byKey;
}

const isLocated = (anchor: HighlightAnchor): boolean =>
  anchor.kind === 'kindle' && anchor.location !== null;

/**
 * The candidates grouped by key, in the order of their keys whatever the
 * candidates' order, each written from the first of its members by what it
 * writes.
 */
function keyGroups(candidates: readonly PassageCandidate[]): KeyGroup[] {
  const byKey = new Map<string, number[]>();
  candidates.forEach((candidate, at) => {
    const key = highlightKey(candidate.anchor, candidate.quote);
    byKey.set(key, [...(byKey.get(key) ?? []), at]);
  });
  const tieBreakOf = (at: number) => (candidates[at] as PassageCandidate).tieBreak;
  return [...byKey.entries()]
    .map(([key, members]): KeyGroup => {
      const [writer] = [...members].sort((a, b) => compare(tieBreakOf(a), tieBreakOf(b)));
      return { key, members, writer: writer as number };
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

import { readWikiLink } from '../markdown/wikilink-spans.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import {
  PROPOSAL_CONFIDENCES,
  type ProposalConfidence,
  type ProposalKind,
  type ProposalNote,
} from './proposal.ts';

/** The relation of a note a proposal would fill: what two proposals must aim at to conflict. */
export interface ProposalSlot {
  readonly note: VaultPath;
  readonly property: string;
}

/** One value a conflict group offers, with every proposal that proposes it: the first is the one accepted. */
export interface ConflictChoice {
  readonly value: string;
  readonly proposals: readonly ProposalNote[];
}

/**
 * Proposals that cannot all be accepted (#307, Q12): the same kind, the same
 * source and the same slot, but different values — three links for one
 * mention in one meeting, say. One is picked; the others are rejected.
 */
export interface ConflictGroup {
  readonly kind: ProposalKind;
  readonly slot: ProposalSlot;
  /** As the first member cites it; null when none cites a source. */
  readonly source: string | null;
  /** Two or more, in the order the proposals came. */
  readonly choices: readonly ConflictChoice[];
  /** As sure as the least sure member; null when none says. */
  readonly confidence: ProposalConfidence | null;
}

/** What the Proposals section lists: a proposal on its own, or a choice between several. */
export type ProposalEntry = { readonly one: ProposalNote } | { readonly choice: ConflictGroup };

/** The relation a proposal fills, or null when it fills none — then it conflicts with nothing. */
export function proposalSlotOf(proposal: ProposalNote): ProposalSlot | null {
  if (proposal.kind === 'link') {
    return { note: proposal.payload.note, property: proposal.payload.property };
  }
  const { linkFrom } = proposal.payload;
  return linkFrom === null ? null : { note: linkFrom.note, property: linkFrom.property };
}

/** What a proposal proposes for its slot: the link it adds, or the title of the note it makes. */
export function proposalValueOf(proposal: ProposalNote): string {
  return proposal.kind === 'link' ? proposal.payload.link.trim() : proposal.payload.title.trim();
}

/** A source as compared: its note, lower-cased, and the block it names, if any. */
interface SourceKey {
  readonly note: string;
  readonly block: string | null;
}

function sourceKeyOf(source: string | null): SourceKey {
  if (source === null) return { note: '', block: null };
  const link = readWikiLink(source.trim());
  if (link === null) return { note: source.trim().toLowerCase(), block: null };
  return {
    note: link.target.trim().toLowerCase(),
    block: link.heading?.trim().toLowerCase() ?? null,
  };
}

/**
 * Whether two sources are the same: the same note, and the same block when
 * both name one. A proposal citing the note alone sits with those citing
 * its blocks.
 */
function sameSource(a: SourceKey, b: SourceKey): boolean {
  if (a.note !== b.note) return false;
  return a.block === null || b.block === null || a.block === b.block;
}

interface Gathering {
  readonly kind: ProposalKind;
  readonly slot: ProposalSlot;
  readonly sources: SourceKey[];
  readonly members: ProposalNote[];
}

function belongs(
  gathering: Gathering,
  proposal: ProposalNote,
  slot: ProposalSlot,
  source: SourceKey,
) {
  return (
    gathering.kind === proposal.kind &&
    gathering.slot.note === slot.note &&
    gathering.slot.property === slot.property &&
    gathering.sources.some((each) => sameSource(each, source))
  );
}

/** Each slot's proposals, gathered in the order they came, however many values they hold. */
function gather(open: readonly ProposalNote[]): readonly Gathering[] {
  const gatherings: Gathering[] = [];
  for (const proposal of open) {
    const slot = proposalSlotOf(proposal);
    if (slot === null) continue;
    const source = sourceKeyOf(proposal.source);
    const found = gatherings.find((each) => belongs(each, proposal, slot, source));
    if (found !== undefined) {
      found.members.push(proposal);
      found.sources.push(source);
    } else {
      gatherings.push({ kind: proposal.kind, slot, sources: [source], members: [proposal] });
    }
  }
  return gatherings;
}

/** The proposals of one slot by value, each value once, in the order first proposed. */
function choicesOf(members: readonly ProposalNote[]): readonly ConflictChoice[] {
  const byValue = new Map<string, ProposalNote[]>();
  for (const proposal of members) {
    const value = proposalValueOf(proposal);
    const held = byValue.get(value);
    if (held === undefined) byValue.set(value, [proposal]);
    else held.push(proposal);
  }
  return [...byValue].map(([value, proposals]) => ({ value, proposals }));
}

/** The least sure of the confidences given; null when none is. */
function leastConfidence(members: readonly ProposalNote[]): ProposalConfidence | null {
  const said = members.flatMap((each) => (each.confidence === null ? [] : [each.confidence]));
  if (said.length === 0) return null;
  // PROPOSAL_CONFIDENCES runs high → low: the last one found is the least sure.
  return [...PROPOSAL_CONFIDENCES].reverse().find((each) => said.includes(each)) ?? null;
}

/**
 * The open proposals that conflict, each group one "pick one" question, in
 * the order their first members came. Computed afresh from what is open:
 * nothing about a group is persisted.
 */
export function conflictGroups(open: readonly ProposalNote[]): readonly ConflictGroup[] {
  return gather(open).flatMap((gathering) => {
    const choices = choicesOf(gathering.members);
    if (choices.length < 2) return [];
    return [
      {
        kind: gathering.kind,
        slot: gathering.slot,
        source: gathering.members[0]?.source ?? null,
        choices,
        confidence: leastConfidence(gathering.members),
      },
    ];
  });
}

/**
 * The open proposals as the section lists them: each on its own, except
 * those in a conflict group, which stand together where the first of them
 * was.
 */
export function proposalEntries(open: readonly ProposalNote[]): readonly ProposalEntry[] {
  const groups = conflictGroups(open);
  const groupOf = new Map<VaultPath, ConflictGroup>();
  for (const group of groups) {
    for (const choice of group.choices) {
      for (const proposal of choice.proposals) groupOf.set(proposal.path, group);
    }
  }
  const placed = new Set<ConflictGroup>();
  return open.flatMap((proposal): ProposalEntry[] => {
    const group = groupOf.get(proposal.path);
    if (group === undefined) return [{ one: proposal }];
    if (placed.has(group)) return [];
    placed.add(group);
    return [{ choice: group }];
  });
}

/** The proposals "Accept all high confidence" accepts: the sure ones that need no choice. */
export function acceptableAtOnce(entries: readonly ProposalEntry[]): readonly VaultPath[] {
  return entries.flatMap((entry) =>
    'one' in entry && entry.one.confidence === 'high' ? [entry.one.path] : [],
  );
}

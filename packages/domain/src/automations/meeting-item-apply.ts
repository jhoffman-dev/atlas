/**
 * Which of a meeting's action items become the owner's tasks without a click
 * (ADR-0036, "Action items become tasks, for the owner only"). The model
 * names an owner and a confidence; whether a task is made is decided here,
 * never by the model.
 *
 * A task is made only for an item that is the vault owner's — the cited
 * turn's speaker is them, and the model's owner (a hint) agrees — that
 * nothing caps, at medium confidence or above, from a meeting that arrived
 * after the rule (not a backfill), in a vault that says who its owner is.
 * Everything else stays a proposal, as before. An item a task already stands
 * for is skipped; another item on the turn that task was made from is a
 * proposal.
 */

import { sameMeetingIdentity, type MeetingIdentity } from '../meetings/meeting-holding.ts';
import { ownerAddressesInUse } from '../meeting-links/vault-owner.ts';
import { TASK_KEYS } from '../gtd/gtd-status.ts';
import { readWikiLink } from '../markdown/wikilink-spans.ts';
import { vocabularyKey } from '../terms/spelling.ts';
import {
  PROPOSAL_CONFIDENCES,
  type NotePayload,
  type ProposalConfidence,
} from '../proposals/proposal.ts';
import { atlasItemKey } from './claude-proposal-id.ts';
import { namesNote, type AnswerVault, type CheckedProposal } from './proposal-schema.ts';

/**
 * The least sure an uncapped item of the owner's may be and still be made a
 * task. One constant: medium errs toward a task the owner can delete over an
 * item they never saw (ADR-0036, Q4).
 */
export const TASK_CONFIDENCE_FLOOR: ProposalConfidence = 'medium';

/**
 * What keeps the owner's item a proposal at any confidence: the cited turn
 * was spoken by someone else, or by nobody the transcript names; the model
 * wrote "we", or the owner with others; or it called the owner's item a
 * waiting-for.
 */
export type MeetingItemCap =
  'spoken-by-another' | 'unnamed-speaker' | 'we' | 'with-others' | 'mixed-kind';

/** An action item as the domain read it, before anything is decided about it. */
export interface MeetingItemClaim {
  /** Whose it is: the vault's owner, someone else, or nobody it can tell. */
  readonly owner: 'self' | 'other' | 'undecided';
  /** Whose it is, as an identity holds it: `self`, a lower-cased name, `?name` or blank. */
  readonly ownerKey: string;
  readonly caps: readonly MeetingItemCap[];
}

/** What a run knows beyond the answer, read by the step: never by the model. */
export interface MeetingItemsRun {
  /** `YYYY-MM-DD`, from the injected clock: a due date before it is not set. */
  readonly today: string;
  /** Whether the meeting arrived before the rule's own file: a backfill makes proposals only. */
  readonly backfilled: boolean;
  /**
   * The first-imported copy, when another copy of the meeting exists: only it
   * makes tasks. A transcript's block ids are its own, so a copy's items stay
   * proposals rather than be keyed on another recording's turns.
   */
  readonly primaryMeeting?: MeetingIdentity;
  /** Every task made from an item, in the vault and the Archive: its `atlas_item` and its title. */
  readonly madeItems: readonly MadeItem[];
  /** Every task already linked to the meeting. */
  readonly linkedTasks: readonly LinkedTask[];
}

/**
 * A task made from an item before. Its key is the turn and the owner, so the
 * title tells which of the owner's items on that turn it was.
 */
export interface MadeItem {
  /** Its `atlas_item`. */
  readonly key: string;
  /** Its title, as the task now holds it. */
  readonly title: string;
}

/** A task already linked to the meeting, as far as skipping an item goes. */
export interface LinkedTask {
  /** Its `source`: the block link it cites, if any. */
  readonly source: string;
  /** Whose it is, as an identity holds it ({@link MeetingItemClaim.ownerKey}): `self` for the owner's own. */
  readonly owner: string;
}

/** Why an item stays a proposal. */
export type ProposedBecause =
  | 'owner-unknown'
  | 'backfilled'
  | 'decision'
  | 'not-an-action-item'
  | 'not-imported'
  | 'someone-elses'
  | 'owner-undecided'
  | 'below-floor'
  | 'turn-already-a-task'
  | 'copy-of-another-recording';

export type MeetingItemDecision =
  /** A task made now: the note to make, and what it is known by. */
  | { readonly outcome: 'task'; readonly atlasItem: string; readonly payload: NotePayload }
  | { readonly outcome: 'proposal'; readonly because: ProposedBecause }
  | {
      readonly outcome: 'proposal';
      readonly because: 'capped';
      readonly caps: readonly MeetingItemCap[];
    }
  /** A task already stands for it: nothing is made, not even a proposal. */
  | {
      readonly outcome: 'skipped';
      readonly because: 'already-made' | 'block-cited';
      readonly atlasItem: string;
    };

export interface MeetingItemsDecision {
  readonly items: readonly {
    readonly proposal: CheckedProposal;
    readonly decision: MeetingItemDecision;
  }[];
  /**
   * Why no item of this meeting could be made a task, when that is the
   * meeting's and not an item's: the vault does not say who its owner is
   * (the Inbox's warning), or the meeting is a backfill. Null otherwise.
   */
  readonly noTasksBecause: 'owner-unknown' | 'backfilled' | null;
}

/** Who the vault's owner is, as far as deciding whose an item is goes. */
export type OwnerSettings = Pick<AnswerVault, 'selfName' | 'selfEmails' | 'people'>;

/**
 * Whether the vault says who its owner is: a profile name, or addresses —
 * its `selfEmails`, or with none the owner's own Person note's, found by that
 * name. With neither, no item can be known to be theirs.
 */
export function vaultNamesItsOwner({ selfName, selfEmails, people }: OwnerSettings): boolean {
  const name = selfName?.trim() ?? '';
  return name !== '' || ownerAddressesInUse({ selfEmails, people, selfName }).length > 0;
}

/**
 * What becomes of each of a meeting's checked proposals, in the answer's
 * order. Two of the owner's items citing one turn are one `atlas_item`: the
 * first is the task, and the rest stay proposals, so none is lost and a rerun
 * of the same answer decides the same.
 */
export function decideMeetingItems({
  proposals,
  vault,
  run,
}: {
  proposals: readonly CheckedProposal[];
  vault: OwnerSettings;
  run: MeetingItemsRun;
}): MeetingItemsDecision {
  const noTasksBecause = !vaultNamesItsOwner(vault)
    ? 'owner-unknown'
    : run.backfilled
      ? 'backfilled'
      : null;
  const claimed = new Set<string>();
  const items = proposals.map((proposal) => {
    const decision =
      noTasksBecause === null ? decideItem({ proposal, run, claimed }) : proposed(noTasksBecause);
    return { proposal, decision };
  });
  return { items, noTasksBecause };
}

function decideItem({
  proposal,
  run,
  claimed,
}: {
  proposal: CheckedProposal;
  run: MeetingItemsRun;
  /** The keys an earlier item of this answer was decided for. */
  claimed: Set<string>;
}): MeetingItemDecision {
  if (proposal.kind === 'decision') return proposed('decision');
  const claim = proposal.meetingItem;
  if (claim === undefined) return proposed('not-an-action-item');
  return (
    notTheOwnersTask(claim, proposal.confidence) ??
    ownersTask({ proposal, run, claimed, owner: claim.ownerKey })
  );
}

const proposed = (because: ProposedBecause): MeetingItemDecision => ({
  outcome: 'proposal',
  because,
});

/** Why an action item is not the owner's task to make: whose it is, then the caps, then the floor. */
function notTheOwnersTask(
  claim: MeetingItemClaim,
  confidence: ProposalConfidence,
): MeetingItemDecision | null {
  if (claim.owner === 'other') return proposed('someone-elses');
  if (claim.owner === 'undecided') return proposed('owner-undecided');
  if (claim.caps.length > 0) return { outcome: 'proposal', because: 'capped', caps: claim.caps };
  return atLeast(confidence, TASK_CONFIDENCE_FLOOR) ? null : proposed('below-floor');
}

/** The owner's item as a task: made, or skipped when a task already stands for it. */
function ownersTask({
  proposal,
  run,
  claimed,
  owner,
}: {
  proposal: CheckedProposal;
  run: MeetingItemsRun;
  claimed: Set<string>;
  owner: string;
}): MeetingItemDecision {
  const { meeting } = proposal.cites;
  if (meeting === null) return proposed('not-imported');
  if (run.primaryMeeting !== undefined && !sameMeetingIdentity(run.primaryMeeting, meeting)) {
    return proposed('copy-of-another-recording');
  }
  const atlasItem = atlasItemKey({ meeting, block: proposal.cites.block, owner });
  const made = run.madeItems.filter(({ key }) => key === atlasItem);
  if (made.length > 0) return madeBefore({ proposal, made, claimed, atlasItem });
  if (claimed.has(atlasItem)) return proposed('turn-already-a-task');
  claimed.add(atlasItem);
  if (citedByLinkedTask(proposal, owner, run.linkedTasks)) {
    return { outcome: 'skipped', because: 'block-cited', atlasItem };
  }
  return { outcome: 'task', atlasItem, payload: taskPayload(proposal.payload, run.today) };
}

/**
 * An item on a turn a task was already made from: skipped when it is that
 * task — the same title, whatever the answer's order — and otherwise a
 * proposal, so an item the new answer adds to the turn is never lost.
 */
function madeBefore({
  proposal,
  made,
  claimed,
  atlasItem,
}: {
  proposal: CheckedProposal;
  made: readonly MadeItem[];
  claimed: Set<string>;
  atlasItem: string;
}): MeetingItemDecision {
  const title = titleKey(proposal.payload.title);
  if (claimed.has(atlasItem) || !made.some((each) => titleKey(each.title) === title)) {
    return proposed('turn-already-a-task');
  }
  claimed.add(atlasItem);
  return { outcome: 'skipped', because: 'already-made', atlasItem };
}

/** A title as two are compared: case, spacing and punctuation aside. */
function titleKey(title: string): string {
  return vocabularyKey(title)
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim();
}

function atLeast(confidence: ProposalConfidence, floor: ProposalConfidence): boolean {
  // The list runs from most sure to least.
  return PROPOSAL_CONFIDENCES.indexOf(confidence) <= PROPOSAL_CONFIDENCES.indexOf(floor);
}

/**
 * Whether a task of the item's owner, linked to the meeting, already cites
 * the block the item does — one the person made and linked by hand, or one
 * made before: a link to that block of that meeting, however its target is
 * spelt. Someone else's task on the same turn is not the owner's.
 */
function citedByLinkedTask(
  proposal: CheckedProposal,
  owner: string,
  linkedTasks: readonly LinkedTask[],
): boolean {
  const { note, block } = proposal.cites;
  return linkedTasks.some(({ source, owner: taskOwner }) => {
    if (taskOwner !== owner) return false;
    const link = readWikiLink(source.trim());
    if (link === null || link.heading !== `#^${block}`) return false;
    return namesNote(link.target, note);
  });
}

/**
 * The note the task is: the proposal's, without a due date that has passed.
 * What was said is kept in its body instead, so the date is not lost.
 */
function taskPayload(payload: NotePayload, today: string): NotePayload {
  const due = payload.properties[TASK_KEYS.due];
  if (typeof due !== 'string' || due >= today) return payload;
  const properties = Object.fromEntries(
    Object.entries(payload.properties).filter(([key]) => key !== TASK_KEYS.due),
  );
  const said = `Due ${due}, as said in the meeting: that day had passed when this task was made, so it has no due date.`;
  return {
    ...payload,
    properties,
    body: [payload.body, said].filter((text) => text !== '').join('\n\n'),
  };
}

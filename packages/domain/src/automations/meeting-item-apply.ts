/**
 * Which of a meeting's action items become the owner's tasks without a click
 * (ADR-0036, "Action items become tasks, for the owner only"), and which
 * reach the owner at all (#226). The model names an owner and a confidence;
 * what becomes of an item is decided here, never by the model.
 *
 * A task is made only for an item that is the vault owner's — the cited
 * turn's speaker is them, and the model's owner (a hint) agrees — that
 * nothing caps, at high confidence, from a meeting that arrived after the
 * rule (not a backfill), in a vault that says who its owner is.
 *
 * What the owner should still see goes into the meeting's one review
 * proposal (`meetingReview`): their own items DFAI is less sure of, a
 * waiting-for they asked for, and a decision they took part in that the
 * model is sure was made. Everything else is left out: low confidence, other
 * people's items, items nobody can be named for, and decisions the owner
 * had no part in. An item a task already stands for is skipped; another item
 * on the turn that task was made from goes to the review.
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
import type { AutomationDraft } from './automation-rule.ts';
import { atlasItemKey } from './claude-proposal-id.ts';
import { namesNote, type AnswerVault, type CheckedProposal } from './proposal-schema.ts';

/**
 * The least sure an uncapped item of the owner's may be and still be made a
 * task. High: a task the owner never asked for costs them more than an item
 * they review once (#226, which moved it up from ADR-0036's medium).
 */
export const TASK_CONFIDENCE_FLOOR: ProposalConfidence = 'high';

/**
 * The least sure an item may be and still reach the owner, in the meeting's
 * review: below it, an item is left out (#226).
 */
export const REVIEW_CONFIDENCE_FLOOR: ProposalConfidence = 'medium';

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
  /**
   * Whether the owner asked for it: the model says so and the owner spoke in
   * the exchange it cites. What keeps someone else's item (#226).
   */
  readonly askedByOwner: boolean;
}

/** A meeting's decision as the domain read it: whether the owner took part in the exchange it cites. */
export interface MeetingDecisionClaim {
  readonly ownerTookPart: boolean;
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

/** Why an item goes to the meeting's review rather than becoming a task. */
export type ProposedBecause =
  | 'owner-unknown'
  | 'backfilled'
  | 'decision'
  | 'not-an-action-item'
  | 'not-imported'
  | 'asked-for'
  | 'below-floor'
  | 'turn-already-a-task'
  | 'copy-of-another-recording';

/** Why an item never reaches the owner (#226). */
export type LeftOutBecause =
  /** Less sure than {@link REVIEW_CONFIDENCE_FLOOR}. */
  | 'unsure'
  /** Someone else's, which the owner did not ask for. */
  | 'someone-elses'
  /** Nobody, or more than one person, could be named. */
  | 'owner-undecided'
  /** A decision the owner took no part in. */
  | 'not-the-owners-decision';

export type MeetingItemDecision =
  /** A task made now: the note to make, and what it is known by. */
  | { readonly outcome: 'task'; readonly atlasItem: string; readonly payload: NotePayload }
  | { readonly outcome: 'proposal'; readonly because: ProposedBecause }
  | {
      readonly outcome: 'proposal';
      readonly because: 'capped';
      readonly caps: readonly MeetingItemCap[];
    }
  /** Not the owner's, or not sure enough to show them: nothing is made. */
  | { readonly outcome: 'left-out'; readonly because: LeftOutBecause }
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
 * Whether an enabled rule would make the owner's tasks (`apply: mine`) while
 * the vault does not say who its owner is (#181): the Inbox says so, on
 * every run until it is fixed, since no task can be made meanwhile.
 */
export function ownerNeededBy(
  rules: readonly Pick<AutomationDraft, 'enabled' | 'action'>[],
  owner: OwnerSettings,
): boolean {
  const makesTasks = rules.some(
    ({ enabled, action }) => enabled && action.kind === 'claude' && action.apply === 'mine',
  );
  return makesTasks && !vaultNamesItsOwner(owner);
}

/**
 * What becomes of each of a meeting's checked proposals, in the answer's
 * order. Two of the owner's items citing one turn are one `atlas_item`: the
 * first is the task, and the rest go to the meeting's review, so none is lost
 * and a rerun of the same answer decides the same.
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
  const items = proposals.map((proposal) => ({
    proposal,
    decision: decideItem({ proposal, run, claimed, noTasksBecause }),
  }));
  return { items, noTasksBecause };
}

function decideItem({
  proposal,
  run,
  claimed,
  noTasksBecause,
}: {
  proposal: CheckedProposal;
  run: MeetingItemsRun;
  /** The keys an earlier item of this answer was decided for. */
  claimed: Set<string>;
  /** Why no item of the meeting may be a task: what would be one is shown for review instead. */
  noTasksBecause: MeetingItemsDecision['noTasksBecause'];
}): MeetingItemDecision {
  if (proposal.kind === 'decision') return decisionShown(proposal);
  const claim = proposal.meetingItem;
  if (claim === undefined) return proposed('not-an-action-item');
  const notATask = notTheOwnersTask(claim, proposal.confidence);
  if (notATask !== null) return notATask;
  if (noTasksBecause !== null) return proposed(noTasksBecause);
  return ownersTask({ proposal, run, claimed, owner: claim.ownerKey });
}

const leftOut = (because: LeftOutBecause): MeetingItemDecision => ({
  outcome: 'left-out',
  because,
});

/**
 * A decision reaches the owner only when it was made where they took part —
 * a turn of theirs in the exchange it cites — and the model is sure it was
 * settled, not discussed (#226). It is never made a note without a click.
 */
function decisionShown(proposal: CheckedProposal): MeetingItemDecision {
  if (proposal.meetingDecision?.ownerTookPart !== true) return leftOut('not-the-owners-decision');
  return proposal.confidence === 'high' ? proposed('decision') : leftOut('unsure');
}

const proposed = (because: ProposedBecause): MeetingItemDecision => ({
  outcome: 'proposal',
  because,
});

/**
 * Why an action item is not the owner's task to make: whose it is, then how
 * sure, then the caps, then the floor. Someone else's reaches the owner only
 * when they asked for it, and nothing below the review's floor reaches them.
 */
function notTheOwnersTask(
  claim: MeetingItemClaim,
  confidence: ProposalConfidence,
): MeetingItemDecision | null {
  if (claim.owner === 'undecided') return leftOut('owner-undecided');
  if (claim.owner === 'other' && !claim.askedByOwner) return leftOut('someone-elses');
  if (!atLeast(confidence, REVIEW_CONFIDENCE_FLOOR)) return leftOut('unsure');
  if (claim.owner === 'other') return proposed('asked-for');
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
  const { title } = proposal.payload;
  if (claimed.has(atlasItem) || !made.some((each) => sameItemTitle(each.title, title))) {
    return proposed('turn-already-a-task');
  }
  claimed.add(atlasItem);
  return { outcome: 'skipped', because: 'already-made', atlasItem };
}

/** Whether two titles name one item: case, spacing and punctuation aside. */
export function sameItemTitle(left: string, right: string): boolean {
  return titleKey(left) === titleKey(right);
}

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

/**
 * What Claude pulls out of a meeting (P29-05, ADR-0028): the `meeting-items`
 * output. Each item is something somebody took on, something decided, or
 * something to chase, citing the one transcript turn it came from.
 *
 * The model says what and who in words; everything a proposal then does is
 * decided here. An item the vault's owner took on is a task in the Inbox; one
 * somebody else took on is a task Waiting on them; a decision is a Decision
 * note; a follow-up is an Inbox task tagged `follow-up`. Each joins the
 * meeting it cites (`tasks`, `decisions`) once accepted.
 *
 * An item whose `source_block` is not a turn of a meeting the model was shown
 * is left out and reported, and the rest are kept: a model cites a line that
 * is not there now and then, and one such item should not lose a meeting's
 * worth of the others. Anything else wrong with an item still refuses the
 * whole answer, as for every output.
 */

import { NEW_TASK_STATUS, TASK_KEYS, WAITING_STATUS } from '../gtd/gtd-status.ts';
import { wikiLinkTargetFor } from '../markdown/resolve-wikilink.ts';
import { readWikiLink } from '../markdown/wikilink-spans.ts';
import {
  MEETING_DECISIONS_KEY,
  MEETING_TASKS_KEY,
} from '../meetings/meeting-extraction-properties.ts';
import { meetingTurnsOf, providerNextStepsOf } from '../meetings/meeting-turns.ts';
import type { TranscriptTurn } from '../meetings/transcript.ts';
import { PROPOSAL_CONFIDENCES, type ProposalConfidence } from '../proposals/proposal.ts';
import { TAGS_KEY } from '../tags/note-tags.ts';
import { noteTitle } from '../vault/vault-entry.ts';
import { truncated } from './answer-limits.ts';
import { shownNotes, type AnsweredNote } from './answered-note.ts';
import { itemOwner, type ItemOwner } from './meeting-item-owner.ts';
import {
  citedBlockProblem,
  isRecord,
  namesNote,
  refused,
  type AnswerContext,
  type DroppedItem,
  type PromptData,
  type ProposalDraft,
  type ProposalSchema,
  type Reading,
} from './proposal-schema.ts';

/** What a rule's `output:` calls it. */
export const MEETING_ITEMS_OUTPUT = 'meeting-items';

/** The tag a follow-up's task carries, so follow-ups can be listed apart from tasks. */
export const FOLLOW_UP_TAG = 'follow-up';

const ITEM_KINDS = ['task', 'waiting', 'decision', 'follow-up'] as const;
type ItemKind = (typeof ITEM_KINDS)[number];

/** An owner is a name, not a sentence. */
const MAX_OWNER_CHARACTERS = 120;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

interface MeetingItem {
  readonly kind: ItemKind;
  readonly title: string;
  /** Who took it on, as the answer wrote them; blank when it named nobody. */
  readonly owner: string;
  /** `YYYY-MM-DD`, when a date was said. */
  readonly due: string | null;
  readonly sourceBlock: string;
  readonly confidence: ProposalConfidence;
}

function readMeetingItem(value: unknown): Reading<MeetingItem> {
  if (!isRecord(value)) return refused('It is not an object.');
  const kind = ITEM_KINDS.find((known) => known === value['kind']);
  if (kind === undefined) return refused(`Its kind is not one of ${ITEM_KINDS.join(', ')}.`);
  const { title, owner = '', due = null, source_block: sourceBlock } = value;
  if (typeof title !== 'string' || title.trim() === '') return refused('It has no "title".');
  if (owner !== null && typeof owner !== 'string') return refused('Its "owner" is not text.');
  if ((owner ?? '').length > MAX_OWNER_CHARACTERS) {
    return refused(`Its "owner" is longer than a name: at most ${MAX_OWNER_CHARACTERS}.`);
  }
  const day = readDue(due);
  if (day === undefined) return refused('Its "due" is not a date written YYYY-MM-DD.');
  if (typeof sourceBlock !== 'string') return refused('It has no "source_block".');
  const confidence = PROPOSAL_CONFIDENCES.find((known) => known === value['confidence']);
  if (confidence === undefined) {
    return refused(`Its confidence is not one of ${PROPOSAL_CONFIDENCES.join(', ')}.`);
  }
  return {
    ok: true,
    value: { kind, title: title.trim(), owner: owner ?? '', due: day, sourceBlock, confidence },
  };
}

/** A due date as written: null for none, undefined when it is not a real day. */
function readDue(value: unknown): string | null | undefined {
  if (value === null || value === '') return null;
  const match = typeof value === 'string' ? DATE.exec(value.trim()) : null;
  if (match === null) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? match[0] : undefined;
}

/** The turn an item cites, in a meeting the model was shown — or why it cites none. */
type CitedTurn =
  | {
      readonly ok: true;
      readonly meeting: AnsweredNote;
      readonly turn: TranscriptTurn;
      /** The citation as a link the shared check reads: `[[Meeting#^t0004]]`. */
      readonly source: string;
    }
  | { readonly ok: false; readonly reason: string };

const BARE_ID = /^\^?([A-Za-z0-9-]+)$/;

/** What a `source_block` names: a turn's id, and the meeting when it was written as a link. */
function writtenCitation(sourceBlock: string): { id: string; target: string | null } | null {
  const written = sourceBlock.trim();
  const bare = BARE_ID.exec(written);
  if (bare !== null) return { id: bare[1]!, target: null };
  const link = readWikiLink(written);
  if (link === null || link.embed || !link.heading?.startsWith('#^')) return null;
  const id = link.heading.slice(2);
  return id === '' ? null : { id, target: link.target };
}

/**
 * The transcript turn an item's `source_block` is: an id (`t0004`) of a turn
 * of the one meeting this answer is about. Only a turn of the Transcript
 * counts: a block of the summary or of the provider's next steps is not what
 * was said.
 *
 * One meeting, never several: which meeting an accepted task is linked back
 * to follows from the turn it cites, so an answer about two meetings could
 * file one's task under the other — and two notes of one title could not be
 * told apart at all. A run asks about each meeting alone (`readsInParts`); an
 * answer checked against more than one note has every item left out.
 */
function citedTurn(item: MeetingItem, context: AnswerContext): CitedTurn {
  const cited = writtenCitation(item.sourceBlock);
  if (cited === null) {
    return unfound(`Its source_block ${quoted(item.sourceBlock)} is not the id of a turn.`);
  }
  const [meeting, ...others] = shownNotes(context.notes);
  if (others.length > 0) return unfound('This output reads one meeting at a time.');
  if (meeting?.meeting === undefined) return unfound('This run read no meeting to cite a turn of.');
  const from = noteTitle(meeting.path);
  if (cited.target !== null && !namesNote(cited.target, meeting.path)) {
    return unfound(`It cites ${quoted(cited.target)}, which is not the meeting it was taken from.`);
  }
  const turn = meetingTurnsOf(meeting.text).find((each) => each.blockId === cited.id);
  if (turn === undefined) {
    return unfound(
      `${from} has no transcript turn ^${truncated(cited.id, 40)} that Claude was shown.`,
    );
  }
  const source = `[[${linkTarget(meeting, context)}#^${cited.id}]]`;
  // The shared check reads it again, its own way (outside a code fence): what it would refuse is left out here.
  const problem = citedBlockProblem(source, context.notes);
  return problem === null ? { ok: true, meeting, turn, source } : unfound(problem);
}

const unfound = (reason: string): CitedTurn => ({ ok: false, reason });
const quoted = (text: string): string => JSON.stringify(truncated(text, 80));

/** What a link to the meeting is written as: spelt against the vault's notes when the run knows them. */
function linkTarget(meeting: AnsweredNote, { vault }: AnswerContext): string {
  return vault === undefined
    ? noteTitle(meeting.path)
    : wikiLinkTargetFor(meeting.path, vault.notePaths);
}

function droppedItem(item: MeetingItem, context: AnswerContext): DroppedItem | null {
  const cited = citedTurn(item, context);
  return cited.ok ? null : { title: item.title, reason: cited.reason };
}

function draftsOfItem(item: MeetingItem, context: AnswerContext): ProposalDraft[] {
  const cited = citedTurn(item, context);
  // An item that cites no turn was left out before this is asked.
  if (!cited.ok) return [];
  const from = noteTitle(cited.meeting.path);
  if (item.kind === 'decision') {
    return [
      {
        kind: 'decision',
        payload: {
          title: item.title,
          properties: { meeting: `[[${linkTarget(cited.meeting, context)}]]` },
        },
        source: cited.source,
        confidence: item.confidence,
        why: `Decided in ${from}.`,
        joinsMeeting: MEETING_DECISIONS_KEY,
      },
    ];
  }
  const due = item.due === null ? {} : { [TASK_KEYS.due]: item.due };
  if (item.kind === 'follow-up') {
    return [
      {
        kind: 'follow-up',
        payload: {
          title: item.title,
          properties: { [TASK_KEYS.status]: NEW_TASK_STATUS, [TAGS_KEY]: [FOLLOW_UP_TAG], ...due },
        },
        source: cited.source,
        confidence: item.confidence,
        why: `A follow-up from ${from}: yours to chase.`,
        joinsMeeting: MEETING_TASKS_KEY,
      },
    ];
  }
  const task = ownedTask({ item, cited, context });
  return [
    {
      kind: 'task',
      payload: { title: item.title, properties: { ...task.properties, ...due } },
      source: cited.source,
      confidence: task.unsure ? 'low' : item.confidence,
      why: task.why,
      joinsMeeting: MEETING_TASKS_KEY,
    },
  ];
}

/** A task as its owner makes it: where it starts, who it waits on, and what the card says of both. */
interface OwnedTask {
  readonly properties: Readonly<Record<string, unknown>>;
  readonly why: string;
  /** Whose it is rests on a guess: its confidence is low whatever the answer said. */
  readonly unsure: boolean;
}

/**
 * The task an action item makes, by who took it on (the mine / waiting-for
 * split). The owner's own is an Inbox task. Anyone else's is Waiting on them:
 * linked when the vault has their Person note, and otherwise their name as
 * text, said so. With nobody named it is an Inbox task with an empty
 * "waiting_on" to fill in, at low confidence. A cited turn with no named
 * speaker makes whoever was named a guess: low confidence too.
 */
function ownedTask({
  item,
  cited,
  context,
}: {
  item: MeetingItem;
  cited: Extract<CitedTurn, { ok: true }>;
  context: AnswerContext;
}): OwnedTask {
  const from = noteTitle(cited.meeting.path);
  const owner = itemOwner(item.owner, {
    attendees: cited.meeting.meeting?.attendees ?? [],
    people: context.vault?.people ?? [],
    selfName: context.vault?.selfName ?? null,
  });
  if (owner.kind === 'unknown') {
    return {
      properties: { [TASK_KEYS.status]: NEW_TASK_STATUS, [TASK_KEYS.waitingOn]: '' },
      why: `Claude could not tell whose this is. Edit it to say who it waits on — set status to ${WAITING_STATUS} and waiting_on to their name — or accept it as yours.`,
      unsure: true,
    };
  }
  const guessed = cited.turn.speaker.kind === 'unknown';
  const guess = guessed
    ? ' The turn it cites has no named speaker, so whose it is is a guess.'
    : '';
  if (owner.kind === 'self') {
    const mixed = item.kind === 'waiting';
    const doubt = mixed
      ? ' Claude called it a waiting-for but named you, so check whose it is.'
      : '';
    return {
      properties: { [TASK_KEYS.status]: NEW_TASK_STATUS },
      why: `Yours, from ${from}.${doubt}${guess}`,
      unsure: mixed || guessed,
    };
  }
  return {
    properties: {
      [TASK_KEYS.status]: WAITING_STATUS,
      [TASK_KEYS.waitingOn]: waitingOn(owner, context),
    },
    why: `${owner.name} took this on in ${from}, so it waits on them.${unlinked(owner)}${guess}`,
    unsure: guessed,
  };
}

/** Who a task waits on, as its `waiting_on` holds them: a link to their note, or their name. */
function waitingOn(
  owner: Exclude<ItemOwner, { kind: 'self' | 'unknown' }>,
  context: AnswerContext,
) {
  if (owner.kind === 'named') return owner.name;
  return `[[${wikiLinkTargetFor(owner.person.path, context.vault?.notePaths ?? [])}]]`;
}

/** What the card says when the owner is a name with no one note to link. */
function unlinked(owner: Exclude<ItemOwner, { kind: 'self' | 'unknown' }>): string {
  if (owner.kind === 'person') return '';
  return owner.several
    ? ` More than one Person note could be ${owner.name}, so waiting_on holds the name as text: edit it to link the right one.`
    : ` There is no Person note for ${owner.name} yet, so waiting_on holds the name as text.`;
}

/** The most of the vocabulary a prompt carries: spellings, not a document. */
const MAX_TERMS_SHOWN = 300;

/**
 * What the model is told beside a meeting, as data: who its owner and
 * attendees are, the provider's own next steps — hints, each to be found in a
 * turn or left out — and the spellings the Terms page keeps.
 */
function meetingData(context: AnswerContext): PromptData[] {
  const meetings = context.notes.filter((note) => note.meeting !== undefined);
  if (meetings.length === 0) return [];
  const terms = (context.vault?.terms ?? []).slice(0, MAX_TERMS_SHOWN);
  const hints = meetings.flatMap((note) => hintLines(note));
  return [
    {
      about: 'who was in each meeting',
      text: meetings.map((note) => peopleLines(note, context)).join('\n\n'),
    },
    ...(hints.length > 0
      ? [{ about: 'the provider’s own next steps: hints, never a source', text: hints.join('\n') }]
      : []),
    ...(terms.length > 0
      ? [{ about: 'the right spellings of names and terms', text: terms.join('\n') }]
      : []),
  ];
}

function peopleLines(note: AnsweredNote, { vault }: AnswerContext): string {
  const self = vault?.selfName ?? null;
  const directory = { attendees: [], people: vault?.people ?? [], selfName: self };
  const attendees = (note.meeting?.attendees ?? []).map((attendee) => {
    if (attendee.group) return `- ${attendee.name}: a group address, not a person`;
    const owner = itemOwner(attendee.name, { ...directory, attendees: [attendee] });
    return `- ${attendee.name}${owner.kind === 'self' ? ': the vault’s owner' : ''}`;
  });
  return [
    `Meeting: ${noteTitle(note.path)}`,
    `The vault’s owner, written “You” in the transcript: ${self ?? 'not named in their profile'}`,
    attendees.length > 0 ? 'Attendees:' : 'Attendees: none listed',
    ...attendees,
  ].join('\n');
}

function hintLines(note: AnsweredNote): string[] {
  const steps = providerNextStepsOf(note.text);
  if (steps.length === 0) return [];
  return [
    `Meeting: ${noteTitle(note.path)}`,
    ...steps.map(({ owner, text }) => `- ${owner === null ? 'nobody named' : owner}: ${text}`),
  ];
}

export const MEETING_ITEMS: ProposalSchema<MeetingItem> = {
  name: MEETING_ITEMS_OUTPUT,
  key: 'items',
  itemShape:
    `{ "kind": one of ${ITEM_KINDS.join(', ')}; "title": what is to be done, or what was decided, in a few words; ` +
    '"owner": who took it on, named as the attendees are — "You" for the vault’s owner, "" when nobody can be named; ' +
    '"due": optional, a date as YYYY-MM-DD, only when one was said; "source_block": the turn it came from; ' +
    '"confidence": high, medium or low }.',
  itemKeys: ['kind', 'title', 'owner', 'due', 'source_block', 'confidence'],
  citation:
    '"source_block" is the id at the end of the one transcript turn the item came from, as written there without its ^: "t0004". ' +
    'Only a turn of the Transcript you were shown counts — never the summary, the notes or the provider’s next steps. ' +
    'An item that cites anything else is left out.',
  meetingRelations: [MEETING_TASKS_KEY, MEETING_DECISIONS_KEY],
  readItem: readMeetingItem,
  dropped: droppedItem,
  draftsOf: draftsOfItem,
  readsVault: true,
  readsInParts: true,
  dataFor: meetingData,
};

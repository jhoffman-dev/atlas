/**
 * A meeting's one review proposal (#226): what the "After a meeting" rule
 * was not sure enough to make a task of, but the owner should still see —
 * their own items at medium confidence, a waiting-for they asked for, a
 * decision they took part in. One card per meeting, never one per item, so
 * a long meeting cannot fill the Inbox.
 *
 * Accepting it makes one task, in the Inbox, whose body lists the items as a
 * checklist, each with the turn it came from: the owner ticks off or makes
 * tasks of the ones that are theirs. Rejecting it is one answer for all.
 */

import { TASK_KEYS, NEW_TASK_STATUS } from '../gtd/gtd-status.ts';
import { readWikiLink } from '../markdown/wikilink-spans.ts';
import { TASK_MEETING_KEY } from '../meetings/meeting-extraction-properties.ts';
import { digestOf } from '../sources/merge.ts';
import { noteTitle } from '../vault/vault-entry.ts';
import type { CheckedProposal } from './proposal-schema.ts';

/** What every review's `distinguishedBy` starts with: no item's owner is written so. */
const REVIEW_MARK = 'review:';

/**
 * The review of one meeting's items, in the order given (the transcript's),
 * or null when there is nothing to review. Every item must cite the same
 * meeting: the review is that meeting's.
 *
 * It is known (its proposal id) by the meeting, the review's title and the
 * items in it: the same answer read again makes the same review, so a rerun
 * makes none twice, and an answer to corrected words makes a new one.
 */
export function meetingReview(items: readonly CheckedProposal[]): CheckedProposal | null {
  const [first] = items;
  if (first === undefined) return null;
  const { note } = first.cites;
  if (items.some((item) => item.cites.note !== note)) {
    throw new Error('A meeting review lists the items of one meeting.');
  }
  const meetingLink = readWikiLink(first.source)?.target ?? noteTitle(note);
  const count = items.length === 1 ? '1 item' : `${items.length} items`;
  return {
    kind: 'task',
    payload: {
      title: `Review what ${noteTitle(note)} left for you`,
      folder: null,
      properties: {
        [TASK_KEYS.status]: NEW_TASK_STATUS,
        [TASK_MEETING_KEY]: `[[${meetingLink}]]`,
      },
      body: [
        'Atlas was not sure enough to make these tasks. Make a task of each that is yours, and delete the rest.',
        '',
        ...items.map(reviewLine),
      ].join('\n'),
      linkFrom: null,
    },
    source: first.source,
    cites: first.cites,
    confidence: 'medium',
    why: `${count} from ${noteTitle(note)} that may be yours: accept to keep them as one task to go through, or reject them all.`,
    distinguishedBy: `${REVIEW_MARK}${digestOf(items.map(itemKey).join('\n'))}`,
    sharedAcrossRules: false,
  };
}

/** One checklist line: what kind of item it is, what, when, and the turn it came from. */
function reviewLine(item: CheckedProposal): string {
  const { title, properties } = item.payload;
  const due = properties[TASK_KEYS.due];
  const when = typeof due === 'string' && due !== '' ? ` (due ${due})` : '';
  return `- [ ] ${prefixOf(item)}${title}${when} ${item.source}`;
}

function prefixOf(item: CheckedProposal): string {
  if (item.kind === 'decision') return 'Decided: ';
  if (item.kind === 'follow-up') return 'Follow up: ';
  const waitingOn = item.payload.properties[TASK_KEYS.waitingOn];
  return typeof waitingOn === 'string' && waitingOn.trim() !== ''
    ? `Waiting on ${waitingOn.trim()}: `
    : '';
}

/** What tells one item from another in a review: its kind, its turn and its title, case aside. */
function itemKey(item: CheckedProposal): string {
  const title = item.payload.title.replace(/\s+/g, ' ').trim().toLowerCase();
  return JSON.stringify([item.kind, item.cites.block, title]);
}

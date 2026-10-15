/**
 * What the declared step reads of the tasks already made, before it makes
 * any (ADR-0036, "Identity key"): every task made from a meeting's item, in
 * the vault and the Archive, by its `atlas_item`; and whose each task linked
 * to the meeting is. Both are read from the vault, never from the model.
 */

import { TASK_KEYS } from '../gtd/gtd-status.ts';
import { readWikiLink } from '../markdown/wikilink-spans.ts';
import { MEETING_ITEM_KEY } from '../meetings/meeting-extraction-properties.ts';
import type { MeetingIdentity } from '../meetings/meeting-holding.ts';
import type { CompiledQuery } from '../query/view-query.ts';
import { atlasItemKey } from './claude-proposal-id.ts';
import { sameItemTitle, type MadeItem } from './meeting-item-apply.ts';

/** The property a task made from an item keeps its exact title in, when its file name could not. */
const TITLE_KEY = 'title';

/**
 * Every note that carries an `atlas_item`, with the title it keeps, if any:
 * the index holds the Archive too, so a task ticked done and archived is
 * found as well. Rows are `path`, `key` and `title`.
 */
export function compileMadeItemsQuery(): CompiledQuery {
  return {
    sql: `/* meeting items: made */ SELECT item.path AS "path", item.value_text AS "key", title.value_text AS "title"
 FROM props AS item LEFT JOIN props AS title ON title.path = item.path AND title.key = ? AND title.idx = 0
 WHERE item.key = ? AND item.value_text IS NOT NULL ORDER BY item.path`,
    parameters: [TITLE_KEY, MEETING_ITEM_KEY],
  };
}

/**
 * Whose a task linked to a meeting is, as an item's identity holds it
 * (`MeetingItemClaim.ownerKey`): the person it waits on, by name — a link by
 * its target's title — or, waiting on nobody, the vault owner's own (`self`).
 */
export function linkedTaskOwner(properties: Readonly<Record<string, unknown>>): string {
  const waitingOn = properties[TASK_KEYS.waitingOn];
  const first = Array.isArray(waitingOn) ? (waitingOn as unknown[])[0] : waitingOn;
  const written = typeof first === 'string' ? first.trim() : '';
  if (written === '') return 'self';
  const link = readWikiLink(written);
  const name = link === null || link.embed ? written : lastSegment(link.target);
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** A link's target as a person is named: its note's title, without a folder or `.md`. */
function lastSegment(target: string): string {
  return target.slice(target.lastIndexOf('/') + 1).replace(/\.md$/i, '');
}

/**
 * The task already made for a meeting's item, when one is: the same
 * `atlas_item` — the meeting, the block its source cites, whose it is — and
 * the same title, as the declared step tells a made item from another on the
 * same turn. What Accept asks before making a leftover proposal's task twice.
 */
export function madeTaskFor({
  meeting,
  source,
  owner,
  title,
  madeItems,
}: {
  meeting: MeetingIdentity;
  /** The block link the item cites: `[[2026-10-14 Standup#^t0001]]`. */
  source: string;
  /** Whose it is, as an identity holds it (`linkedTaskOwner`). */
  owner: string;
  title: string;
  madeItems: readonly MadeItem[];
}): MadeItem | null {
  const link = readWikiLink(source.trim());
  const block = link?.heading?.startsWith('#^') === true ? link.heading.slice(2) : '';
  if (block === '') return null;
  const key = atlasItemKey({ meeting, block, owner });
  return madeItems.find((made) => made.key === key && sameItemTitle(made.title, title)) ?? null;
}

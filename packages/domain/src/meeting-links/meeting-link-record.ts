import { linkedNotes } from '../types/relation-links.ts';
import { createVaultPath, InvalidVaultPathError, type VaultPath } from '../vault/vault-path.ts';
import { isProposalPath } from '../proposals/proposal.ts';
import { MEETING_LINK_KEYS } from './meeting-link-keys.ts';

/**
 * What linking a meeting did, kept on the meeting itself (P29-06) as its
 * corrections are (P28-06): the links it added to each relation, or `none`
 * when it was linked and nothing was sure, or `undone` once they were taken
 * back. A meeting holding the key in any form has been linked and is never
 * linked again by itself; one without it never was — hand-made, or let in
 * while linking failed — and is linked when the "after a meeting" rule next
 * runs on it.
 *
 * ```yaml
 * atlas_links:
 *   - key: people
 *     added: ["[[Mara Quill]]"]
 * atlas_link_proposals: [Inbox/Proposals/Add Tobias Fenn.md]
 * ```
 */
export const LINKS_KEY = 'atlas_links';
/** The proposals linking wrote for this meeting, by where it wrote them: what undoing it takes away while they are open. */
export const LINK_PROPOSALS_KEY = 'atlas_link_proposals';
/** What `atlas_links` says when the meeting was linked and nothing was sure. */
export const LINKS_NONE = 'none';
/** What `atlas_links` says once its links were taken back, so they are never added again. */
export const LINKS_UNDONE = 'undone';

/** The links linking added to one relation of the meeting, each as it was written. */
export interface AddedLinks {
  readonly key: string;
  readonly added: readonly string[];
}

/** What a meeting's frontmatter records of its linking. */
export interface MeetingLinkRecord {
  readonly links: readonly AddedLinks[];
  readonly proposals: readonly VaultPath[];
}

/** Whether a meeting has been linked — or its links undone — so it is never linked again by itself. */
export function wasLinked(properties: Readonly<Record<string, unknown>>): boolean {
  return Object.hasOwn(properties, LINKS_KEY);
}

/** Whether a meeting's links were taken back. */
export function linksUndone(properties: Readonly<Record<string, unknown>>): boolean {
  return properties[LINKS_KEY] === LINKS_UNDONE;
}

/** What the frontmatter is changed by when a meeting is linked: the record of what was added and proposed. */
export function linkRecordProperties({
  links,
  proposals,
}: MeetingLinkRecord): Record<string, unknown> {
  const added = links.filter((each) => each.added.length > 0);
  return {
    [LINKS_KEY]:
      added.length === 0
        ? LINKS_NONE
        : added.map(({ key, added: written }) => ({ key, added: [...written] })),
    ...(proposals.length > 0 && { [LINK_PROPOSALS_KEY]: [...proposals] }),
  };
}

/** What the frontmatter is changed by once a meeting's links are undone. */
export const UNDONE_LINK_PROPERTIES: Readonly<Record<string, unknown>> = {
  [LINKS_KEY]: LINKS_UNDONE,
  [LINK_PROPOSALS_KEY]: null,
};

/**
 * What a meeting's frontmatter records of its linking that an undo could
 * take back: links it added, proposals it wrote, or both. Null when there is
 * nothing to take back — never linked, nothing sure and nothing proposed, or
 * undone already. A frontmatter is text anyone can edit, so only what
 * linking itself writes is believed: links added to the two relations it
 * declares, and proposals where proposals wait.
 */
export function recordedLinks(
  properties: Readonly<Record<string, unknown>>,
): MeetingLinkRecord | null {
  if (!wasLinked(properties) || linksUndone(properties)) return null;
  const written = properties[LINKS_KEY];
  const links = Array.isArray(written) ? written.flatMap(addedOf) : [];
  const proposals = proposalsOf(properties[LINK_PROPOSALS_KEY]);
  return links.length === 0 && proposals.length === 0 ? null : { links, proposals };
}

function addedOf(value: unknown): AddedLinks[] {
  if (typeof value !== 'object' || value === null) return [];
  const { key, added } = value as Record<string, unknown>;
  if (typeof key !== 'string' || !(MEETING_LINK_KEYS as readonly string[]).includes(key)) return [];
  if (!Array.isArray(added)) return [];
  const links = added.filter((each): each is string => typeof each === 'string' && each !== '');
  return links.length === 0 ? [] : [{ key, added: links }];
}

function proposalsOf(value: unknown): VaultPath[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((each) => {
    if (typeof each !== 'string' || !isProposalPath(each)) return [];
    try {
      return [createVaultPath(each)];
    } catch (error) {
      if (error instanceof InvalidVaultPathError) return [];
      throw error;
    }
  });
}

/** The links a relation gained, as written: those in its value after that were not in it before. */
export function addedLinks(before: unknown, after: readonly string[]): string[] {
  const held = new Set(linkedNotes(before));
  return after.filter((link) => !held.has(link));
}

/** What undoing a meeting's links changes, and how many links it takes away. */
export interface LinksTakenBack {
  readonly values: Readonly<Record<string, unknown>>;
  readonly removed: number;
}

/**
 * The meeting's relations without the links its linking added, and the mark
 * that says they were undone. A link is taken away only where it still stands
 * exactly as linking wrote it: one the person has since removed, rewritten or
 * added themselves is theirs, and stays — as does every link an accepted
 * proposal added. A relation left empty is cleared.
 */
export function linksTakenBack({
  properties,
  record,
}: {
  properties: Readonly<Record<string, unknown>>;
  record: MeetingLinkRecord;
}): LinksTakenBack {
  const values: Record<string, unknown> = {};
  let removed = 0;
  for (const { key, added } of record.links) {
    const held = properties[key];
    // Not links any more (a hand edit made it text, or a map): nothing of it is linking's to remove.
    if (typeof held !== 'string' && !Array.isArray(held)) continue;
    const taken = new Set(added);
    const now = linkedNotes(held);
    const rest = now.filter((link) => !taken.has(link));
    if (rest.length === now.length) continue;
    removed += now.length - rest.length;
    values[key] = rest.length === 0 ? null : rest;
  }
  return { values: { ...values, ...UNDONE_LINK_PROPERTIES }, removed };
}

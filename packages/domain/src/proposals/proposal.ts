import { isArchivedPath } from '../archive/archive.ts';
import { readWikiLink } from '../markdown/wikilink-spans.ts';
import { isMeetingInboxPath } from '../meetings/meeting-arrival.ts';
import { PERSON_TYPE } from '../people/person.ts';
import { cleanEntryName } from '../vault/new-note.ts';
import { noteTitle } from '../vault/vault-entry.ts';
import { isUserSpaceNote } from '../vault/vault-visibility.ts';
import { createVaultPath, InvalidVaultPathError, type VaultPath } from '../vault/vault-path.ts';

/**
 * A proposal is a note (ADR-0028): what Claude or an automation suggests, kept
 * in `Inbox/Proposals/` until James accepts, edits or rejects it. Being a note
 * it syncs, survives a restart and can be queried; accepting writes what its
 * `payload` says, and nothing else (P29-02).
 */
export const PROPOSAL_TYPE = 'proposal';

/** The built-in type a decision proposal makes. */
export const DECISION_TYPE = 'decision';

/** Where proposals wait. Accepted and rejected ones go to the Archive, so it holds only open ones. */
export const PROPOSALS_FOLDER = 'Inbox/Proposals';

/** The start of every path in the proposals folder, lower-cased: the disk does not tell `Inbox` from `inbox`. */
const PROPOSALS_PREFIX = `${PROPOSALS_FOLDER.toLowerCase()}/`;

export const PROPOSAL_KINDS = [
  'task',
  'decision',
  'follow-up',
  'person',
  'link',
  'term',
  'project',
] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export const PROPOSAL_STATES = ['open', 'accepted', 'rejected'] as const;
export type ProposalState = (typeof PROPOSAL_STATES)[number];

export const PROPOSAL_CONFIDENCES = ['high', 'medium', 'low'] as const;

/**
 * Where a proposal was answered, recorded on it as `answered_via` when it is
 * accepted or rejected: the app's buttons, or the local API (an MCP client
 * James asked). The Archive keeps who said yes.
 */
export const ANSWERED_VIA_KEY = 'answered_via';
export const PROPOSAL_ANSWERERS = ['app', 'api'] as const;
export type ProposalAnswerer = (typeof PROPOSAL_ANSWERERS)[number];
export type ProposalConfidence = (typeof PROPOSAL_CONFIDENCES)[number];

/** A proposal that makes a note: everything but a link. */
export type NoteProposalKind = Exclude<ProposalKind, 'link'>;

/** The type of the note each kind makes. A follow-up is a task to chase someone. */
export const PROPOSAL_NOTE_TYPES: Readonly<Record<NoteProposalKind, string>> = {
  task: 'task',
  'follow-up': 'task',
  decision: DECISION_TYPE,
  person: PERSON_TYPE,
  term: 'term',
  project: 'project',
};

/** What accepting a note proposal makes: a note called `title`, in `folder` or at the top of the vault. */
export interface NotePayload {
  readonly title: string;
  readonly folder: VaultPath | null;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly body: string;
}

/**
 * What accepting a link proposal changes: `link` added to the relation
 * `property` of the note at `note`, which held `digest` (`digestOf` its whole
 * text) when the proposal was made.
 */
export interface LinkPayload {
  readonly note: VaultPath;
  readonly property: string;
  readonly link: string;
  readonly digest: string;
}

interface ProposalCommon {
  readonly path: VaultPath;
  readonly state: ProposalState;
  readonly confidence: ProposalConfidence | null;
  /** The block it came from, as a link — `[[2026-10-01 Standup#^t0003]]` — or null when it cites none. */
  readonly source: string | null;
  /** The rule and run that made it, as written. */
  readonly madeBy: string | null;
}

export type ProposalNote =
  | (ProposalCommon & { readonly kind: NoteProposalKind; readonly payload: NotePayload })
  | (ProposalCommon & { readonly kind: 'link'; readonly payload: LinkPayload });

export type ProposalPayload = ProposalNote['payload'];

export type ProposalReading =
  | { readonly ok: true; readonly proposal: ProposalNote }
  | { readonly ok: false; readonly problem: string };

export type PayloadReading =
  | { readonly ok: true; readonly payload: ProposalPayload }
  | { readonly ok: false; readonly problem: string };

/** Whether a note sits in the proposals folder, however `Inbox` is cased. */
export function isProposalPath(path: string): boolean {
  return path.toLowerCase().startsWith(PROPOSALS_PREFIX);
}

/** Whether a note's properties say it is a proposal. */
export function isProposalNote(properties: Readonly<Record<string, unknown>>): boolean {
  const type = properties['type'];
  return typeof type === 'string' && type.trim().toLowerCase() === PROPOSAL_TYPE;
}

/**
 * A proposal note read from its frontmatter, or why it cannot be: a kind
 * Atlas does not know, a state it does not know, or a payload that does not
 * say what to write. A confidence it does not know reads as none, since it
 * changes nothing Accept does.
 */
export function readProposal({
  path,
  properties,
}: {
  path: VaultPath;
  properties: Readonly<Record<string, unknown>>;
}): ProposalReading {
  const kind = oneOf(PROPOSAL_KINDS, properties['kind']);
  if (kind === null) return refused(`It has no kind Atlas knows: ${known(PROPOSAL_KINDS)}.`);
  const state =
    properties['state'] === undefined ? 'open' : oneOf(PROPOSAL_STATES, properties['state']);
  if (state === null) return refused(`Its state is not one of ${known(PROPOSAL_STATES)}.`);
  const payload = readProposalPayload(kind, properties['payload']);
  if (!payload.ok) return payload;
  const common: ProposalCommon = {
    path,
    state,
    confidence: oneOf(PROPOSAL_CONFIDENCES, properties['confidence']),
    source: text(properties['source']),
    madeBy: text(properties['made_by']),
  };
  return { ok: true, proposal: { ...common, kind, payload: payload.payload } as ProposalNote };
}

/**
 * The payload a proposal of `kind` carries, checked: what Accept writes. Also
 * what an edit is read back through, so an edited payload is held to the
 * rules the proposal was.
 */
export function readProposalPayload(kind: ProposalKind, value: unknown): PayloadReading {
  if (!isRecord(value)) return refused('Its payload does not say what to write.');
  return kind === 'link' ? readLinkPayload(value) : readNotePayload(value);
}

function readNotePayload(value: Readonly<Record<string, unknown>>): PayloadReading {
  const title = cleanEntryName(text(value['title']) ?? '');
  if (title === '') return refused('Its payload needs a title.');
  const properties = value['properties'] ?? {};
  if (!isRecord(properties)) return refused('Its payload’s properties must be keys and values.');
  if (Object.keys(properties).some((key) => key.trim() === '')) {
    return refused('A property in its payload has no name.');
  }
  const folder = text(value['folder']);
  // Whether a proposal may write there is Accept's question (applyProposal), asked of the vault as it is.
  const at = folder === null ? null : vaultPath(folder);
  if (at instanceof Error) return refused(at.message);
  const body = value['body'] ?? '';
  if (typeof body !== 'string') return refused('Its payload’s body must be text.');
  return { ok: true, payload: { title, folder: at, properties, body } };
}

function readLinkPayload(value: Readonly<Record<string, unknown>>): PayloadReading {
  const note = text(value['note']);
  const property = text(value['property']);
  const link = text(value['link']);
  const digest = text(value['digest']);
  if (note === null || property === null || link === null || digest === null) {
    return refused('A link proposal needs the note, the property, the link and the digest.');
  }
  const read = readWikiLink(link);
  if (read === null || read.embed) return refused(`${link} is not a link to a note.`);
  const path = notePath(note);
  if (path instanceof Error) return refused(path.message);
  return { ok: true, payload: { note: path, property, link, digest } };
}

/**
 * Why a proposal may not write at `path` — a note, or a folder it would make
 * one in — or null when it may. Only user space: not `.atlas` or a hidden
 * folder, nor one the vault's walk never reads (`node_modules`, in any case,
 * at any depth), where a note would be invisible. Nor the Archive, which is
 * what is done with, nor the proposals folder, where proposals wait.
 */
export function proposedWriteRefusal(path: VaultPath): string | null {
  const shown = JSON.stringify(path);
  // A folder is judged as what would be written inside it.
  const within = `${path}/`;
  if (!isUserSpaceNote(createVaultPath(`${within}note.md`))) {
    return `${shown} is hidden configuration, or a folder the vault never shows; a proposal does not write there.`;
  }
  if (isArchivedPath(within)) return `${shown} is in the Archive; a proposal does not write there.`;
  if (isProposalPath(within)) {
    return `${shown} is where proposals wait; a proposal does not write there.`;
  }
  // The meeting import judges every note that lands there as a meeting file (ADR-0027).
  if (isMeetingInboxPath(`${within}note.md`)) {
    return `${shown} is where meeting files land; a proposal does not write there.`;
  }
  return null;
}

/**
 * A payload as it is written back into its proposal's `payload:` — after an
 * edit, so the Archive keeps what was accepted. Only what it holds is written:
 * no empty folder, properties or body.
 */
export function payloadRecord(payload: ProposalPayload): Readonly<Record<string, unknown>> {
  if ('digest' in payload) return { ...payload };
  const { title, folder, properties, body } = payload;
  return {
    title,
    ...(folder !== null && { folder }),
    ...(Object.keys(properties).length > 0 && { properties }),
    ...(body !== '' && { body }),
  };
}

/** One line saying what a proposal would do, as the Inbox lists it. */
export function proposalHeadline(proposal: ProposalNote): string {
  if (proposal.kind !== 'link') return proposal.payload.title;
  const { note, property, link } = proposal.payload;
  return `${noteTitle(note)} · ${property} → ${link}`;
}

function notePath(raw: string): VaultPath | Error {
  const path = vaultPath(raw);
  if (path instanceof Error) return path;
  if (!/\.(md|markdown)$/i.test(path)) return new Error(`${JSON.stringify(raw)} is not a note.`);
  const refusal = proposedWriteRefusal(path);
  return refusal === null ? path : new Error(refusal);
}

function vaultPath(raw: string): VaultPath | Error {
  try {
    return createVaultPath(raw);
  } catch (error) {
    if (error instanceof InvalidVaultPathError) {
      return new Error(`${JSON.stringify(raw)} is not a path inside the vault.`);
    }
    throw error;
  }
}

function oneOf<T extends string>(options: readonly T[], value: unknown): T | null {
  if (typeof value !== 'string') return null;
  const wanted = value.trim().toLowerCase();
  return options.find((option) => option === wanted) ?? null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function known(options: readonly string[]): string {
  return options.join(', ');
}

function refused(problem: string): { readonly ok: false; readonly problem: string } {
  return { ok: false, problem };
}

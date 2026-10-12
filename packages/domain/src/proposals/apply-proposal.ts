import { linkTargets } from '../index/relation-rows.ts';
import { resolveWikiLinkTarget, wikiLinkTargetFor } from '../markdown/resolve-wikilink.ts';
import { withLink, linkedNotes } from '../types/relation-links.ts';
import { fitFileNameStem } from '../vault/file-name-bytes.ts';
import { TASK_KEYS } from '../gtd/gtd-status.ts';
import { tidySpelling } from '../terms/spelling.ts';
import { VARIANTS_KEY } from '../terms/term.ts';
import { cleanEntryName, nextAvailableNotePath } from '../vault/new-note.ts';
import { noteTitle } from '../vault/vault-entry.ts';
import { joinVaultPath, VAULT_ROOT, type VaultPath } from '../vault/vault-path.ts';
import { foldedVaultPath } from '../vault/vault-spelling.ts';
import {
  PROPOSAL_NOTE_TYPES,
  proposedWriteRefusal,
  type LinkFrom,
  type LinkPayload,
  type NotePayload,
  type NoteProposalKind,
  type ProposalNote,
} from './proposal.ts';

/** One change accepting a proposal makes to the vault. */
export type ProposalWrite =
  | {
      readonly kind: 'create';
      readonly path: VaultPath;
      readonly properties: Readonly<Record<string, unknown>>;
      readonly body: string;
    }
  | {
      readonly kind: 'set';
      readonly path: VaultPath;
      readonly changes: Readonly<Record<string, unknown>>;
    };

/** The note a link proposal changes, as it is now. */
export interface LinkTarget {
  /** `digestOf` its whole text. */
  readonly digest: string;
  /** The relation's value now; undefined when the note has none. */
  readonly value: unknown;
  /** The relation by its type: whether it holds several notes. Null when the type has no such relation. */
  readonly relation: { readonly many: boolean } | null;
}

/** The term the vault already has by a proposal's right spelling, as its note is now. */
export interface HeldTerm {
  readonly path: VaultPath;
  /** Its misheard spellings, as its frontmatter lists them. */
  readonly variants: readonly string[];
}

/** What accepting a proposal is checked against. */
export interface ProposalVault {
  /** Every note in the vault now: a new note never takes a path one of them has. */
  readonly notePaths: readonly VaultPath[];
  /**
   * The note a link proposal changes — or a note proposal's `linkFrom` note —
   * as it is now; null when it is not there, or the proposal names none.
   */
  readonly target: LinkTarget | null;
  /**
   * The `type` of the note already at the path a new note would take, as it
   * is written, when there is one: a proposal that joins a relation links
   * that note instead of making it, but only if it is the kind of note
   * proposed.
   */
  readonly heldTypes?: readonly string[] | undefined;
  /**
   * For a term proposal: the term of that right spelling the vault already
   * has, wherever it is filed; null or left out when it has none. Accepting
   * then adds the proposal's misheard spellings to it rather than making a
   * second term of the same name.
   */
  readonly term?: HeldTerm | null | undefined;
}

export type ProposalApplication =
  | { readonly ok: true; readonly writes: readonly ProposalWrite[] }
  | { readonly ok: false; readonly problem: string };

/** The kinds whose note records the line it came from, in its `source`. */
const CITING_KINDS: ReadonlySet<NoteProposalKind> = new Set(['task', 'follow-up', 'decision']);

/**
 * What accepting a proposal writes, or why it may not be accepted.
 *
 * A task, a follow-up or a decision makes a note of its type citing the block
 * the proposal came from; a person, a term or a project makes a note of its
 * type, and with `linkFrom` is added to that note's relation too. A term the
 * vault already has is not made again: the misheard spellings the proposal
 * carries are added to it (P29-06). A link adds
 * one link to a relation of an existing note. Nothing is written over: a note
 * already at the path a new one would take is a refusal (it may be the very
 * note this proposes), and a note changed since a proposal with a digest was
 * made is too — the proposal was made against what it held then.
 */
export function applyProposal(proposal: ProposalNote, vault: ProposalVault): ProposalApplication {
  if (proposal.state !== 'open') return refused(`It was already ${proposal.state}.`);
  return proposal.kind === 'link' ? applyLink(proposal.payload, vault) : applyNote(proposal, vault);
}

/**
 * The kinds whose note is a record of this proposal's own — a task, a
 * follow-up, a decision: another note of the same name is some other record
 * (last year's finished task), never this one, so a clash is numbered past.
 * A person, a term or a project is a note about a thing in the world, and one
 * already there may be the very one proposed.
 */
const OWN_RECORDS: ReadonlySet<NoteProposalKind> = new Set(['task', 'follow-up', 'decision']);

function applyNote(
  proposal: ProposalNote & { readonly kind: NoteProposalKind },
  { notePaths, target, heldTypes, term }: ProposalVault,
): ProposalApplication {
  const { payload, kind, source } = proposal;
  const refusal = payload.folder === null ? null : proposedWriteRefusal(payload.folder);
  if (refusal !== null) return refused(refusal);
  if (kind === 'term' && term !== undefined && term !== null) return addedVariants(payload, term);
  const gone = waitingOnGone(proposal, notePaths);
  if (gone !== null) return refused(gone);
  const wanted = newNotePath(payload);
  const folded = foldedVaultPath(wanted);
  const found = notePaths.find((note) => foldedVaultPath(note) === folded);
  // Its own record is made where the name is free: "Send the notes 2", never last year's "Send the notes".
  const path =
    found !== undefined && OWN_RECORDS.has(kind)
      ? nextAvailableNotePath({
          folder: payload.folder ?? VAULT_ROOT,
          name: noteTitle(wanted),
          taken: new Set(notePaths),
        })
      : wanted;
  const held = path === wanted ? found : undefined;
  if (held !== undefined && !(kind === 'person' && payload.linkFrom !== null)) {
    return refused(
      `There is already a note at ${path}, which may be this one. Edit the title to make another.`,
    );
  }
  if (held !== undefined && !isKindOfNote(kind, heldTypes)) {
    return refused(
      `There is already a note at ${held} that is not a ${PROPOSAL_NOTE_TYPES[kind]}, so this was left as it is. Edit the title to make another.`,
    );
  }
  const cites = CITING_KINDS.has(kind) && source !== null;
  const properties = {
    type: PROPOSAL_NOTE_TYPES[kind],
    ...withoutType(payload.properties),
    ...(cites && { source }),
  };
  // A person already there is the one proposed — made since by another proposal for them,
  // from another meeting: they are linked, not made again.
  const creates: ProposalWrite[] =
    held === undefined ? [{ kind: 'create', path, properties, body: payload.body }] : [];
  if (payload.linkFrom === null) return { ok: true, writes: creates };
  const joined = joinedRelation({
    linkFrom: payload.linkFrom,
    note: held ?? path,
    notePaths: held === undefined ? [...notePaths, path] : notePaths,
    target,
  });
  return joined.ok ? { ok: true, writes: [...creates, ...joined.writes] } : joined;
}

/** The misheard spellings a term proposal carries, each once, tidied as a term's are. */
export function proposedVariants(payload: NotePayload): string[] {
  const written = payload.properties[VARIANTS_KEY];
  const listed = Array.isArray(written) ? written : written === undefined ? [] : [written];
  const spellings = listed
    .filter((each): each is string => typeof each === 'string')
    .map(tidySpelling)
    .filter((spelling) => spelling !== '');
  return [...new Set(spellings)];
}

/**
 * What accepting a term proposal writes when the vault already has the term:
 * its misheard spellings with the proposal's added, the ones it had kept in
 * their order. Refused when the proposal carries none the term lacks — there
 * is then nothing to accept, and a second term of the name is never made.
 */
function addedVariants(payload: NotePayload, term: HeldTerm): ProposalApplication {
  const held = new Set(term.variants.map(tidySpelling));
  const added = proposedVariants(payload).filter(
    (spelling) => !held.has(spelling) && spelling !== tidySpelling(payload.title),
  );
  if (added.length === 0) {
    return refused(
      `There is already a term “${payload.title}” at ${term.path}, and it lists every misheard spelling this proposes.`,
    );
  }
  return {
    ok: true,
    writes: [
      { kind: 'set', path: term.path, changes: { [VARIANTS_KEY]: [...term.variants, ...added] } },
    ],
  };
}

/**
 * Why a task cannot be accepted because the person it waits on has gone: its
 * `waiting_on` links a note the vault no longer has (renamed or deleted on
 * another Mac since the proposal was made). Refused, with nothing written —
 * a link to nothing would show as waiting on nobody — and the card's Edit can
 * point it at the right person, or at their name as text.
 */
function waitingOnGone(
  { payload }: ProposalNote & { readonly kind: NoteProposalKind },
  notePaths: readonly VaultPath[],
): string | null {
  const value = payload.properties[TASK_KEYS.waitingOn];
  if (typeof value !== 'string') return null;
  const missing = linkTargets(value).find(
    (written) => resolveWikiLinkTarget(written, notePaths) === null,
  );
  return missing === undefined
    ? null
    : `It waits on [[${missing}]], which is not a note any more (renamed or deleted since). Edit waiting_on to the right person, or to their name as text; nothing was written.`;
}

/** Whether a note of these types is what a proposal of `kind` makes. */
function isKindOfNote(kind: NoteProposalKind, types: readonly string[] | undefined): boolean {
  return (types ?? []).some((type) => type.trim().toLowerCase() === PROPOSAL_NOTE_TYPES[kind]);
}

/**
 * The write adding the new note to its `linkFrom` relation — none when the
 * relation already links it, however the link is spelt, or when that note is
 * gone: the note is still made, since what it records is still true.
 */
function joinedRelation({
  linkFrom,
  note,
  notePaths,
  target,
}: {
  linkFrom: LinkFrom;
  note: VaultPath;
  notePaths: readonly VaultPath[];
  target: LinkTarget | null;
}): ProposalApplication {
  if (target === null) return { ok: true, writes: [] };
  if (relationLinks(target.value, notePaths).has(note)) return { ok: true, writes: [] };
  const link = `[[${wikiLinkTargetFor(note, notePaths)}]]`;
  return applyLink({ ...linkFrom, link, digest: null }, { notePaths, target });
}

/** The notes a relation's value links, each resolved as the vault resolves a link. */
function relationLinks(value: unknown, notePaths: readonly VaultPath[]): Set<VaultPath> {
  const resolved = linkedNotes(value)
    .flatMap((item) => linkTargets(item))
    .flatMap((written) => resolveWikiLinkTarget(written, notePaths) ?? []);
  return new Set(resolved);
}

function applyLink(
  payload: LinkPayload,
  { notePaths, target }: Pick<ProposalVault, 'notePaths' | 'target'>,
): ProposalApplication {
  const title = noteTitle(payload.note);
  if (target === null) return refused(`${title} is not there any more.`);
  if (payload.digest !== null && target.digest !== payload.digest) {
    return refused(`${title} changed since this was proposed, so it was left as it is.`);
  }
  if (target.relation === null) {
    return refused(`${title} has no relation called ${payload.property} to link through.`);
  }
  const held = linkedNotes(target.value);
  if (held.includes(payload.link) || linksSameNote(payload.link, target.value, notePaths)) {
    return refused(`${title} already links ${payload.link} in ${payload.property}.`);
  }
  // Without a digest the note may have moved on since; a link set since is a choice, kept.
  if (payload.digest === null && !target.relation.many && held.length > 0) {
    return refused(
      `${title} already links ${held[0]} in ${payload.property}; this would replace it.`,
    );
  }
  const value = withLink({ value: target.value, link: payload.link, many: target.relation.many });
  return {
    ok: true,
    writes: [{ kind: 'set', path: payload.note, changes: { [payload.property]: value } }],
  };
}

/** Whether a relation already links the note `link` means, however either is spelt. */
function linksSameNote(link: string, value: unknown, notePaths: readonly VaultPath[]): boolean {
  const [written] = linkTargets(link);
  const wanted = written === undefined ? null : resolveWikiLinkTarget(written, notePaths);
  return wanted !== null && relationLinks(value, notePaths).has(wanted);
}

/**
 * Where a note proposal's note goes: its title as a file name, cut to what the
 * disk takes, in its folder or at the top.
 */
export function newNotePath(payload: NotePayload): VaultPath {
  const stem = fitFileNameStem(cleanEntryName(payload.title), NOTE_EXTENSION);
  return joinVaultPath(payload.folder ?? VAULT_ROOT, `${stem}${NOTE_EXTENSION}`);
}

const NOTE_EXTENSION = '.md';

/** The payload's properties without a `type`: the kind decides what the note is. */
function withoutType(properties: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).filter(([key]) => key.trim().toLowerCase() !== 'type'),
  );
}

function refused(problem: string): ProposalApplication {
  return { ok: false, problem };
}

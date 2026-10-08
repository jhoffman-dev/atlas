import { withLink, linkedNotes } from '../types/relation-links.ts';
import { noteFileName } from '../vault/new-note.ts';
import { noteTitle } from '../vault/vault-entry.ts';
import { joinVaultPath, VAULT_ROOT, type VaultPath } from '../vault/vault-path.ts';
import { foldedVaultPath } from '../vault/vault-spelling.ts';
import {
  PROPOSAL_NOTE_TYPES,
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

/** What accepting a proposal is checked against. */
export interface ProposalVault {
  /** Every note in the vault now: a new note never takes a path one of them has. */
  readonly notePaths: readonly VaultPath[];
  /** The note a link proposal changes, as it is now; null when it is not there (or the proposal makes a note). */
  readonly target: LinkTarget | null;
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
 * type. A link adds one link to a relation of an existing note. Nothing is
 * written over: a note already at the path a new one would take is a refusal
 * (it may be the very note this proposes), and a note changed since the
 * proposal was made is too — the proposal was made against what it held then.
 */
export function applyProposal(proposal: ProposalNote, vault: ProposalVault): ProposalApplication {
  if (proposal.state !== 'open') return refused(`It was already ${proposal.state}.`);
  return proposal.kind === 'link'
    ? applyLink(proposal.payload, vault.target)
    : applyNote(proposal, vault.notePaths);
}

function applyNote(
  proposal: ProposalNote & { readonly kind: NoteProposalKind },
  notePaths: readonly VaultPath[],
): ProposalApplication {
  const { payload, kind, source } = proposal;
  const path = newNotePath(payload);
  const folded = foldedVaultPath(path);
  if (notePaths.some((note) => foldedVaultPath(note) === folded)) {
    return refused(
      `There is already a note at ${path}, which may be this one. Edit the title to make another.`,
    );
  }
  const cites = CITING_KINDS.has(kind) && source !== null;
  const properties = {
    type: PROPOSAL_NOTE_TYPES[kind],
    ...withoutType(payload.properties),
    ...(cites && { source }),
  };
  return { ok: true, writes: [{ kind: 'create', path, properties, body: payload.body }] };
}

function applyLink(payload: LinkPayload, target: LinkTarget | null): ProposalApplication {
  const title = noteTitle(payload.note);
  if (target === null) return refused(`${title} is not there any more.`);
  if (target.digest !== payload.digest) {
    return refused(`${title} changed since this was proposed, so it was left as it is.`);
  }
  if (target.relation === null) {
    return refused(`${title} has no relation called ${payload.property} to link through.`);
  }
  if (linkedNotes(target.value).includes(payload.link)) {
    return refused(`${title} already links ${payload.link} in ${payload.property}.`);
  }
  const value = withLink({ value: target.value, link: payload.link, many: target.relation.many });
  return {
    ok: true,
    writes: [{ kind: 'set', path: payload.note, changes: { [payload.property]: value } }],
  };
}

/** Where a note proposal's note goes: its title as a file name, in its folder or at the top. */
export function newNotePath(payload: NotePayload): VaultPath {
  return joinVaultPath(payload.folder ?? VAULT_ROOT, noteFileName(payload.title));
}

/** The payload's properties without a `type`: the kind decides what the note is. */
function withoutType(properties: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).filter(([key]) => key.trim().toLowerCase() !== 'type'),
  );
}

function refused(problem: string): ProposalApplication {
  return { ok: false, problem };
}

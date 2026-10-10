import {
  ANSWERED_VIA_KEY,
  applyProposal,
  digestOf,
  FINISHED_TASK_STATUS,
  joinFrontmatter,
  joinVaultPath,
  messageOf,
  parentVaultPath,
  payloadRecord,
  proposalHeadline,
  readProposalPayload,
  splitFrontmatter,
  isTaskNote,
  TASK_KEYS,
  vaultPathName,
  vaultSpellingOf,
  type LinkPayload,
  type LinkTarget,
  type MarkdownDocument,
  type ProposalAnswerer,
  type ProposalNote,
  type ProposalWrite,
  type VaultPath,
} from '@atlas/domain';
import { ProposalRefused, undoProposal, type AppliedProposal } from '../chat/proposals.ts';
import { newNoteTaskRules, withTaskRules } from '../gtd/task-rules.ts';
import { archiveTaskChange } from '../review/review-actions.ts';
import { NoteChangedError } from '../notes/note-changed-error.ts';
import { noteModified } from '../notes/note-modified.ts';
import { loadObjectTypes } from '../types/load-types.ts';
import { unarchiveNotes } from '../archive/index.ts';
import { ensureFolder } from '../vault/create-folder.ts';
import { VaultAccessError } from '../vault/ports.ts';
import { listVaultNotes } from '../vault/read-vault.ts';
import {
  archiveProposal,
  readOpenProposal,
  refuseUnsaved,
  stampProposal,
  type ProposalArchived,
  type ProposalPorts,
} from './proposal-file.ts';

/** What accepting a proposal did, kept so it can be undone in one step. */
export interface AcceptedProposal extends ProposalArchived {
  /** Where the proposal was while it waited. */
  readonly proposal: VaultPath;
  /** What it proposed, in one line. */
  readonly headline: string;
  /** What Accept wrote, each with what undoing it needs. */
  readonly wrote: readonly AppliedProposal[];
}

/** A link proposal's note, as read to check it and write it. */
interface LinkNote {
  readonly target: LinkTarget;
  readonly document: MarkdownDocument;
  readonly text: string;
  readonly modified: number;
}

/**
 * Accepts the proposal at `path`: writes what its payload says — or `payload`,
 * when it was edited first — marks it `state: accepted` and files it in the
 * Archive (P29-02).
 *
 * Nothing is written over. A note made since at the path a new one would
 * take, or a note a link proposal changes that has changed since the proposal
 * was made, refuses the whole accept with the reason; so does unsaved typing
 * in the proposal or the note it changes. Two accepts of one proposal at once
 * make one write: the second finds the note the first made, or the proposal
 * already accepted.
 *
 * What it writes is held to the task rules (ADR-0029) as every write that
 * makes or changes a task is: a task Waiting with nobody is refused with
 * `TaskRuleRefusedError` before anything is written, leaving the proposal
 * open, and one made already finished is dated — or, when it repeats, rolled
 * on to its next date as ticking it done would.
 */
export async function acceptProposalNote({
  ports,
  path,
  today,
  via = 'app',
  payload,
}: {
  ports: ProposalPorts;
  path: VaultPath;
  today: string;
  /** Who answered, recorded on the proposal as `answered_via`: the app's buttons unless said otherwise. */
  via?: ProposalAnswerer;
  /** The payload as edited, in place of the proposal's own. */
  payload?: unknown;
}): Promise<AcceptedProposal> {
  const file = await readOpenProposal(ports, path);
  refuseUnsaved(ports.editors, path);
  const notePaths = await listVaultNotes({ fs: ports.fs });
  const asked = payload === undefined ? file.proposal : edited(file.proposal, payload);
  const proposal = spelledAsVault(asked, notePaths);
  const link = proposal.kind === 'link' ? await readLinkNote(ports, proposal.payload) : null;
  const applied = applyProposal(proposal, { notePaths, target: link?.target ?? null });
  if (!applied.ok) throw new ProposalRefused(applied.problem);

  const ruled = applied.writes.map((write) => heldToTaskRules(ports, { write, link, today }));
  const wrote = await carryOut(ports, ruled, link);
  const headline = proposalHeadline(proposal);
  await stampProposal(
    ports,
    { ...file, path },
    {
      state: 'accepted',
      [ANSWERED_VIA_KEY]: via,
      ...(payload !== undefined && { payload: payloadRecord(proposal.payload) }),
    },
  ).catch(async (cause: unknown) => {
    throw await takenBack(ports, { wrote, headline, cause });
  });
  const archived = await archiveProposal({ ports, path, today });
  return { proposal: path, headline, wrote, ...archived };
}

/**
 * Undoes an accept: takes back what it wrote — if nothing has changed it
 * since — and puts the proposal back in the Inbox, open again. Answers where
 * the proposal is now.
 */
export async function undoAcceptedProposal({
  ports,
  accepted,
}: {
  ports: ProposalPorts;
  accepted: AcceptedProposal;
}): Promise<VaultPath> {
  for (const applied of accepted.wrote) {
    await undoProposal({ fs: ports.fs, openNotes: ports.editors, applied });
  }
  const back = await backFromArchive(ports, accepted);
  await reopen(ports, back).catch((cause: unknown) => {
    throw new ProposalRefused(
      `What it made was taken back and the proposal is at ${back}, but it could not be marked open again: ${messageOf(cause)}`,
    );
  });
  return back;
}

/** Marks the proposal open again, with no record of the answer undone. */
async function reopen(ports: ProposalPorts, path: VaultPath): Promise<void> {
  const { text, modified } = await ports.fs.readTextFile(path);
  await stampProposal(
    ports,
    { path, document: splitFrontmatter(text), modified },
    { state: 'open', [ANSWERED_VIA_KEY]: null },
  );
}

/** The proposal with an edited payload, held to the rules its own was. */
function edited(proposal: ProposalNote, payload: unknown): ProposalNote {
  const reading = readProposalPayload(proposal.kind, payload);
  if (!reading.ok) throw new ProposalRefused(reading.problem);
  return { ...proposal, payload: reading.payload } as ProposalNote;
}

/**
 * A link proposal names its note as its maker spelled it; the disk a Mac
 * vault lives on ignores case, but the panes know each note by one spelling.
 * The note is named as the vault spells it, so its pane is the one asked
 * about typing and the one reloaded. A note proposal is as it was.
 */
function spelledAsVault(proposal: ProposalNote, notePaths: readonly VaultPath[]): ProposalNote {
  if (proposal.kind !== 'link') return proposal;
  const note = vaultSpellingOf(proposal.payload.note, notePaths) ?? proposal.payload.note;
  return { ...proposal, payload: { ...proposal.payload, note } };
}

/** The note a link proposal changes, as it is now; null when it is not there. */
async function readLinkNote(ports: ProposalPorts, payload: LinkPayload): Promise<LinkNote | null> {
  refuseUnsaved(ports.editors, payload.note);
  const read = await ports.fs.readTextFile(payload.note).catch((error: unknown) => {
    // Not there is an answer — the proposal is refused saying so; anything else is a fault.
    if (error instanceof VaultAccessError) return null;
    throw error;
  });
  if (read === null) return null;
  const document = splitFrontmatter(read.text);
  const properties = ports.markdown.frontmatterProperties(document.frontmatter);
  const types = await loadObjectTypes({ fs: ports.fs, markdown: ports.markdown });
  const type = typeNamed(types, properties['type']);
  const relation = type?.properties.find(
    (property) => property.key === payload.property && property.kind === 'relation',
  );
  return {
    target: {
      digest: digestOf(read.text),
      value: properties[payload.property],
      relation: relation === undefined ? null : { many: relation.many },
    },
    document,
    text: read.text,
    modified: read.modified,
  };
}

/** A note's type among the vault's, its name matched in any case and spacing as type files are. */
function typeNamed<Type extends { readonly name: string }>(
  types: readonly Type[],
  name: unknown,
): Type | undefined {
  if (typeof name !== 'string') return undefined;
  const folded = name.trim().toLowerCase();
  return types.find((candidate) => candidate.name.trim().toLowerCase() === folded);
}

/** A proposal's write once held to the task rules: a new note carries the text it will have. */
type RuledWrite =
  | (Extract<ProposalWrite, { kind: 'create' }> & { readonly contents: string })
  | Extract<ProposalWrite, { kind: 'set' }>;

/**
 * One of the proposal's writes as the task rules have it, worked out before
 * anything is written so a refusal leaves the vault as it was: a new note's
 * text judged as a new note's is, a link's change judged against the note it
 * changes.
 */
function heldToTaskRules(
  ports: ProposalPorts,
  { write, link, today }: { write: ProposalWrite; link: LinkNote | null; today: string },
): RuledWrite {
  if (write.kind === 'create') {
    const text = joinFrontmatter(
      ports.markdown.updateFrontmatter(null, finishedAsTicked(write.properties)),
      write.body,
    );
    return {
      ...write,
      contents: newNoteTaskRules({ markdown: ports.markdown, contents: text, today }),
    };
  }
  if (link === null) return write;
  const properties = ports.markdown.frontmatterProperties(link.document.frontmatter);
  return { ...write, changes: withTaskRules({ values: write.changes, today })(properties) };
}

/**
 * A task proposed already finished, as ticking it done would leave it: a
 * repeating one rolls on to its next date and back to Next Action, rather
 * than being made as the end of its series.
 */
function finishedAsTicked(
  properties: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (!isTaskNote(properties) || properties[TASK_KEYS.status] !== FINISHED_TASK_STATUS) {
    return properties;
  }
  const change = archiveTaskChange();
  return { ...properties, ...(typeof change === 'function' ? change(properties) : change) };
}

async function carryOut(
  ports: ProposalPorts,
  writes: readonly RuledWrite[],
  link: LinkNote | null,
): Promise<AppliedProposal[]> {
  const wrote: AppliedProposal[] = [];
  for (const write of writes) {
    wrote.push(
      write.kind === 'create'
        ? await createNote(ports, write)
        : await setOnNote(ports, write, link),
    );
  }
  return wrote;
}

async function createNote(
  ports: ProposalPorts,
  { path: proposed, contents }: Extract<RuledWrite, { kind: 'create' }>,
): Promise<AppliedProposal> {
  const folder = await ensureFolder({ fs: ports.fs, folder: parentVaultPath(proposed) });
  const path = joinVaultPath(folder, vaultPathName(proposed));
  try {
    await ports.fs.createNote({ path, contents });
  } catch (error) {
    // Made in the moment between the check and the write — by another accept, say.
    if ((await noteModified({ fs: ports.fs, path })) !== null) {
      throw new ProposalRefused(`${path} was made just now; nothing was written.`);
    }
    throw error;
  }
  return { kind: 'created', path, modified: (await noteModified({ fs: ports.fs, path })) ?? 0 };
}

async function setOnNote(
  ports: ProposalPorts,
  write: Extract<ProposalWrite, { kind: 'set' }>,
  link: LinkNote | null,
): Promise<AppliedProposal> {
  // applyProposal only sets on a note it was handed, so `link` is that note.
  if (link === null) throw new ProposalRefused(`${write.path} is not there any more.`);
  const { path } = write;
  const contents = ports.markdown.updateFrontmatter(link.document.frontmatter, write.changes);
  let modified: number;
  try {
    modified = await ports.fs.writeTextFile({
      path,
      contents: contents + link.document.body,
      expectedModified: link.modified,
    });
  } catch (error) {
    const changed =
      error instanceof NoteChangedError ||
      (await noteModified({ fs: ports.fs, path })) !== link.modified;
    if (changed) throw new ProposalRefused(`${path} changed just now; nothing was written.`);
    throw error;
  }
  ports.editors.reload(path);
  return { kind: 'edited', path, previous: link.text, modified };
}

/**
 * The refusal for an accept whose proposal could not be marked accepted after
 * its notes were written: they are taken back, so an open proposal never sits
 * beside what accepting it made — or, when they cannot be, the refusal says so.
 */
async function takenBack(
  ports: ProposalPorts,
  {
    wrote,
    headline,
    cause,
  }: { wrote: readonly AppliedProposal[]; headline: string; cause: unknown },
): Promise<Error> {
  const reason = messageOf(cause);
  try {
    for (const applied of wrote) {
      await undoProposal({ fs: ports.fs, openNotes: ports.editors, applied });
    }
  } catch (undoing) {
    return new ProposalRefused(
      `“${headline}” was written, but the proposal could not be marked accepted (${reason}), and taking it back failed: ${messageOf(undoing)}`,
    );
  }
  return new ProposalRefused(`${reason} Nothing was kept.`);
}

/** Where the proposal is once it is out of the Archive — or where it stayed, when it never went. */
async function backFromArchive(
  ports: ProposalPorts,
  accepted: AcceptedProposal,
): Promise<VaultPath> {
  if (accepted.archivedAt === null) return accepted.proposal;
  const outcome = await unarchiveNotes({
    ports,
    paths: [accepted.archivedAt],
    notePaths: await listVaultNotes({ fs: ports.fs }),
    unsavedTyping: 'leave',
  });
  const back = outcome.moves[0]?.move.to;
  if (back === undefined) {
    const why = outcome.failed[0]?.reason ?? 'it could not be moved';
    throw new ProposalRefused(
      `What it made was taken back, but the proposal stays in the Archive: ${why}`,
    );
  }
  return back;
}

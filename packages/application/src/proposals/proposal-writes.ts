import {
  digestOf,
  FINISHED_TASK_STATUS,
  isTaskNote,
  joinFrontmatter,
  joinVaultPath,
  messageOf,
  parentVaultPath,
  splitFrontmatter,
  TASK_KEYS,
  vaultPathName,
  type LinkFrom,
  type LinkTarget,
  type MarkdownDocument,
  type ProposalWrite,
} from '@atlas/domain';
import {
  checkUndo,
  ProposalRefused,
  undoProposal,
  type AppliedProposal,
} from '../chat/proposals.ts';
import { newNoteTaskRules, withTaskRules } from '../gtd/task-rules.ts';
import { archiveTaskChange } from '../review/review-actions.ts';
import { NoteChangedError } from '../notes/note-changed-error.ts';
import { noteModified } from '../notes/note-modified.ts';
import { loadObjectTypes } from '../types/load-types.ts';
import { ensureFolder } from '../vault/create-folder.ts';
import { VaultAccessError } from '../vault/ports.ts';
import { refuseUnsaved, type ProposalPorts } from './proposal-file.ts';

/**
 * What writing a proposal's notes reaches: the vault, the markdown port and
 * the panes. Accept writes through these, and so does making a task from a
 * meeting's action item (#177).
 */
export type NoteWritePorts = Pick<ProposalPorts, 'fs' | 'markdown' | 'editors'>;

/** A link proposal's note, as read to check it and write it. */
export interface LinkNote {
  readonly target: LinkTarget;
  readonly document: MarkdownDocument;
  readonly text: string;
  readonly modified: number;
}

/** The note a proposal links through, as it is now; null when it is not there. */
export async function readLinkNote(
  ports: NoteWritePorts,
  payload: Pick<LinkFrom, 'note' | 'property'>,
): Promise<LinkNote | null> {
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
export type RuledWrite =
  | (Extract<ProposalWrite, { kind: 'create' }> & { readonly contents: string })
  | Extract<ProposalWrite, { kind: 'set' }>;

/**
 * One of the proposal's writes as the task rules have it, worked out before
 * anything is written so a refusal leaves the vault as it was: a new note's
 * text judged as a new note's is, a link's change judged against the note it
 * changes.
 */
export function heldToTaskRules(
  ports: NoteWritePorts,
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

/**
 * Makes the writes, in order. One that fails after another was made takes
 * back what was written, so a note is never left half made: a person made but
 * their meeting not linked, say.
 */
export async function carryOut(
  ports: NoteWritePorts,
  {
    writes,
    link,
    headline,
  }: { writes: readonly RuledWrite[]; link: LinkNote | null; headline: string },
): Promise<AppliedProposal[]> {
  const wrote: AppliedProposal[] = [];
  try {
    for (const write of writes) {
      wrote.push(
        write.kind === 'create'
          ? await createNote(ports, write)
          : await setOnNote(ports, write, link),
      );
    }
  } catch (cause) {
    // A person made but their meeting not linked is half an accept: what was written is taken back.
    if (wrote.length > 0) throw await takenBack(ports, { wrote, headline, cause });
    throw cause;
  }
  return wrote;
}

async function createNote(
  ports: NoteWritePorts,
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
  ports: NoteWritePorts,
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
export async function takenBack(
  ports: NoteWritePorts,
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

/**
 * Takes back what was written, all of it or none: every write is checked
 * before the first is taken back, so a meeting never lists a task that was
 * trashed, nor a task stays after the meeting kept its link.
 */
export async function takeBackAll(
  ports: NoteWritePorts,
  wrote: readonly AppliedProposal[],
): Promise<void> {
  for (const applied of wrote) {
    await checkUndo({ fs: ports.fs, openNotes: ports.editors, applied });
  }
  // Last made, first taken back: the link goes before the note it points at.
  for (const applied of [...wrote].reverse()) {
    await undoProposal({ fs: ports.fs, openNotes: ports.editors, applied });
  }
}

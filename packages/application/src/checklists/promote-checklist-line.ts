import {
  anchorsIn,
  capturedTaskStatus,
  checklistLines,
  inheritedProject,
  joinFrontmatter,
  lineBlockId,
  newBlockId,
  noteTitle,
  promotedTaskName,
  promotedTaskProperties,
  promotedTaskStatus,
  wikiLinkTargetFor,
  withPromotedLine,
  type ChecklistLine,
  type EditorDocument,
  type ObjectType,
  type VaultPath,
} from '@atlas/domain';
import type { OpenNotes } from '../api/ports.ts';
import type { Rng } from '../ports.ts';
import { createNote } from '../notes/create-note.ts';
import { NoteChangedError } from '../notes/note-changed-error.ts';
import { noteModified } from '../notes/note-modified.ts';
import { openNote, type OpenNote } from '../notes/open-note.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { saveNote } from '../notes/save-note.ts';
import { UnsavedTypingError } from '../vault/update-links.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/** The panes, as a write to a note they may hold needs them. */
export type PromotionPanes = Pick<OpenNotes, 'state' | 'reload'>;

/** What promoting a line did, kept so one undo can take back both halves. */
export interface Promotion {
  /** The note the line was in. */
  readonly source: VaultPath;
  /** The task made of it. */
  readonly task: VaultPath;
  /** The note the line was in, as it was before, byte for byte. */
  readonly previous: string;
  /** When each was last written by the promotion: an undo refuses either changed since. */
  readonly sourceModified: number;
  readonly taskModified: number;
}

/** Why a line could not be promoted, or a promotion undone, in words for the person. */
export class PromotionRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromotionRefused';
  }
}

/** Which line to promote: its place among the note's boxes, and the words it was offered with. */
export interface ChecklistLineChoice {
  readonly source: VaultPath;
  /** Its index among the note's boxes, in the order `checklistLines` reads them. */
  readonly line: number;
  /** Its words when it was offered: a line that no longer says them is refused. */
  readonly text: string;
}

/**
 * Promotes a checklist line to a task (P30-03). The task is a new note
 * beside the line's, named by the line's words, whose `source` links to the
 * line and which is filed under the project the line's note is in (or is);
 * it starts where a captured task does, or finished when the line is ticked.
 * The line becomes a link to the task, keeping its box.
 *
 * Both halves go through the writes every note goes through: the task is
 * made by `createNote`, which holds it to the task rules (ADR-0029), and the
 * line is rewritten by `saveNote`, byte-preserving and refused if the note
 * moved on since it was read. The id the source link names is written on the
 * line in that same save (ADR-0022); a line that has its own keeps it. If
 * the save is refused, the task just made is taken back, so nothing is left
 * half done.
 *
 * A note a pane holds unsaved typing in is not written behind that pane's
 * back (`UnsavedTypingError`); one that no longer has the line where, and as,
 * it was offered is refused (`PromotionRefused`). A clean pane holding it
 * reads it again.
 */
export async function promoteChecklistLine({
  fs,
  markdown,
  openNotes,
  rng,
  today,
  notePaths,
  taskType,
  choice,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  openNotes: PromotionPanes;
  rng: Rng;
  /** `YYYY-MM-DD`: what the task rules date by. */
  today: string;
  notePaths: readonly VaultPath[];
  /** The vault's Task type, which says what a new task starts as; null when it has none. */
  taskType: ObjectType | null;
  choice: ChecklistLineChoice;
}): Promise<Promotion> {
  const { source } = choice;
  refuseUnsaved(openNotes, source);
  const note = await openNote({ fs, markdown, path: source });
  const line = chosenLine(note, choice);
  const name = promotedTaskName(line.text);
  if (name === '') throw new PromotionRefused('That line has no words to name a task by.');

  const blockId =
    lineBlockId(note.doc, line.at) ?? newBlockId(() => rng.next(), anchorsIn(note.doc));
  const linkToSource = wikiLinkTargetFor(source, notePaths);
  const properties = promotedTaskProperties({
    status: promotedTaskStatus({ captured: capturedTaskStatus(taskType), done: line.done }),
    linkToSource,
    blockId,
    project: inheritedProject({ properties: note.properties, linkToSource }),
  });
  const task = await createNote({
    fs,
    markdown,
    today,
    name,
    beside: source,
    notePaths,
    contents: joinFrontmatter(markdown.updateFrontmatter(null, properties), ''),
    properties,
  });

  const linkToTask = wikiLinkTargetFor(task, [...notePaths, task]);
  const doc = withPromotedLine(note.doc, { at: line.at, blockId, linkToTask });
  const saved = await savedOrTakenBack({ fs, markdown, openNotes, note, doc, task });
  if (openNotes.state(source) === 'clean') openNotes.reload(source);
  return {
    source,
    task,
    // The split is lossless: frontmatter and body together are the file as read.
    previous: (note.frontmatter ?? '') + note.originalBody,
    sourceModified: saved,
    taskModified: (await noteModified({ fs, path: task })) ?? 0,
  };
}

/** The line chosen, as the note says it now; refused when it is not there or not as offered. */
function chosenLine(note: OpenNote, choice: ChecklistLineChoice): ChecklistLine {
  const line = checklistLines(note.doc)[choice.line];
  if (line === undefined || line.text !== choice.text) {
    throw new PromotionRefused(
      `${noteTitle(choice.source)} changed since that line was offered. Pick it again.`,
    );
  }
  return line;
}

/**
 * The line's note written with the line promoted, and when it was; if the
 * write is refused — typing began in a pane, or the file moved on — the task
 * just made is taken back first, and the refusal said.
 */
async function savedOrTakenBack({
  fs,
  markdown,
  openNotes,
  note,
  doc,
  task,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  openNotes: PromotionPanes;
  note: OpenNote;
  doc: EditorDocument | null;
  task: VaultPath;
}): Promise<number> {
  try {
    if (doc === null) throw new PromotionRefused('That line is no longer a checklist line.');
    refuseUnsaved(openNotes, note.path);
    return (await saveNote({ fs, markdown, note, doc })).note.modified;
  } catch (error) {
    await takeBack({ fs, task, cause: error });
    if (await movedOn({ fs, path: note.path, expected: note.modified, error })) {
      throw new PromotionRefused(
        `${noteTitle(note.path)} changed while the line was being promoted; nothing was changed.`,
      );
    }
    throw error;
  }
}

/**
 * Whether a write was refused because the note moved on since `expected`,
 * however the host worded the refusal.
 */
async function movedOn({
  fs,
  path,
  expected,
  error,
}: {
  fs: VaultFsPort;
  path: VaultPath;
  expected: number;
  error: unknown;
}): Promise<boolean> {
  return error instanceof NoteChangedError || (await noteModified({ fs, path })) !== expected;
}

/** Trashes the task a refused promotion made; if that fails too, says both. */
async function takeBack({
  fs,
  task,
  cause,
}: {
  fs: VaultFsPort;
  task: VaultPath;
  cause: unknown;
}): Promise<void> {
  try {
    await fs.trashEntry({ path: task });
  } catch (trashError) {
    throw new AggregateError(
      [cause, trashError],
      `The line was not changed, and ${noteTitle(task)}, made for it, could not be taken back.`,
      { cause: trashError },
    );
  }
}

/**
 * Takes a promotion back in one step: the line's note gets back its bytes and
 * the task goes to the trash — refused, with nothing changed, when either was
 * written since, or a pane holds unsaved typing in either.
 */
export async function undoPromotion({
  fs,
  openNotes,
  promotion,
}: {
  fs: VaultFsPort;
  openNotes: PromotionPanes;
  promotion: Promotion;
}): Promise<void> {
  const { source, task } = promotion;
  refuseUnsaved(openNotes, source);
  refuseUnsaved(openNotes, task);
  await refuseChanged({ fs, path: task, modified: promotion.taskModified });
  await refuseChanged({ fs, path: source, modified: promotion.sourceModified });
  try {
    await fs.writeTextFile({
      path: source,
      contents: promotion.previous,
      expectedModified: promotion.sourceModified,
    });
  } catch (error) {
    if (await movedOn({ fs, path: source, expected: promotion.sourceModified, error })) {
      throw changedSince(source);
    }
    throw error;
  }
  await fs.trashEntry({ path: task });
  if (openNotes.state(source) === 'clean') openNotes.reload(source);
}

async function refuseChanged({
  fs,
  path,
  modified,
}: {
  fs: VaultFsPort;
  path: VaultPath;
  modified: number;
}): Promise<void> {
  if ((await noteModified({ fs, path })) !== modified) throw changedSince(path);
}

function changedSince(path: VaultPath): PromotionRefused {
  return new PromotionRefused(
    `${noteTitle(path)} changed since the line was promoted; nothing was undone.`,
  );
}

function refuseUnsaved(openNotes: PromotionPanes, path: VaultPath): void {
  if (openNotes.state(path) === 'dirty') throw new UnsavedTypingError(path);
}

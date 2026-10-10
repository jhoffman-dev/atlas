import {
  BLOCK_KEYS,
  BLOCK_TYPE,
  blockTasksWith,
  blockTasksWithout,
  blockTypeOf,
  NEW_NOTE_CONTENTS,
  newBlockName,
  newBlockTimes,
  splitFrontmatter,
  taskLink,
  VAULT_ROOT,
  type BlockTimes,
  type ObjectType,
  type VaultPath,
} from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import { createNote } from '../notes/create-note.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import type { PropertyChanges } from '../query/set-property.ts';
import { findTypeTemplate, loadTemplates, readTemplate } from '../types/templates.ts';
import { forgetNotes } from '../index/refresh-index.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/**
 * Writes a note's properties through whichever of the task rules' chokepoints
 * holds it (ADR-0029): the save of a pane that has it open, else
 * `setNoteProperties`. The app answers with its own; nothing here writes a
 * note's file directly.
 */
export type WriteNoteProperties = (args: {
  path: VaultPath;
  values: PropertyChanges;
}) => Promise<void>;

/** A start and a length that make no block: no time of day, no length, or past a date's range. */
export class BlockTimesError extends Error {
  constructor({ start, minutes }: { start: string; minutes: number }) {
    super(
      `A block cannot run ${String(minutes)} minutes from ${JSON.stringify(start)}: ` +
        'it needs a day and a time, written 2026-10-12T09:00, and a whole number of minutes from 1 to 1440.',
    );
    this.name = 'BlockTimesError';
  }
}

/** Undo found the block changed since the drop, and left it as it is rather than lose that. */
export class BlockChangedError extends Error {
  constructor(block: VaultPath) {
    super(`${block} has changed since the task was scheduled, so it is left as it is.`);
    this.name = 'BlockChangedError';
  }
}

/** What a drop on the calendar did, kept so it can be undone. */
export type Scheduling =
  /** A block made for the task, holding exactly `contents` as it was written. */
  | {
      readonly kind: 'created';
      readonly block: VaultPath;
      readonly task: VaultPath;
      readonly contents: string;
    }
  /** The task linked into a block that was already there. */
  | { readonly kind: 'added'; readonly block: VaultPath; readonly task: VaultPath };

/**
 * A new block for a task (P31-02): `minutes` long from `start`, linking the
 * task, made as every new note is (`createNote`) at the top of the vault —
 * from the Block type's template when the vault has one, with its start, end
 * and tasks written into that frontmatter. Refused with
 * {@link BlockTimesError} before anything is made when the times make no
 * block.
 */
export async function createBlockForTask({
  fs,
  markdown,
  types,
  task,
  start,
  minutes,
  notePaths,
  today,
}: {
  fs: VaultFsPort;
  markdown: Pick<MarkdownPort, 'frontmatterProperties' | 'updateFrontmatter'>;
  types: readonly ObjectType[];
  task: { readonly path: VaultPath; readonly title: string };
  /** When it starts, as wall-clock time: `2026-10-12T09:00`. */
  start: string;
  minutes: number;
  notePaths: readonly VaultPath[];
  /** `YYYY-MM-DD`: what the task rules date a note by, as every new note is made. */
  today: string;
}): Promise<Scheduling & { readonly kind: 'created' }> {
  const times = newBlockTimes({ start, minutes });
  if (times === null) throw new BlockTimesError({ start, minutes });
  const template = await blockTemplate({ fs, type: blockTypeOf(types) });
  const contents = blockContents({
    markdown,
    template,
    times,
    link: taskLink(task.path, notePaths),
  });
  const block = await createNote({
    fs,
    markdown,
    today,
    name: newBlockName(task.title),
    beside: null,
    folder: VAULT_ROOT,
    notePaths,
    contents,
  });
  return { kind: 'created', block, task: task.path, contents };
}

async function blockTemplate({
  fs,
  type,
}: {
  fs: VaultFsPort;
  type: Pick<ObjectType, 'name' | 'label'>;
}): Promise<string | null> {
  const template = findTypeTemplate(await loadTemplates({ fs }), type);
  return template === null ? null : readTemplate({ fs, template });
}

/** The template, or an empty note, with the block's type, times and task written over its frontmatter. */
function blockContents({
  markdown,
  template,
  times,
  link,
}: {
  markdown: Pick<MarkdownPort, 'updateFrontmatter'>;
  template: string | null;
  times: BlockTimes;
  link: string;
}): string {
  const { frontmatter, body } = splitFrontmatter(template ?? NEW_NOTE_CONTENTS);
  const written = markdown.updateFrontmatter(frontmatter, {
    type: BLOCK_TYPE,
    [BLOCK_KEYS.start]: times.start,
    [BLOCK_KEYS.end]: times.end,
    [BLOCK_KEYS.tasks]: [link],
  });
  return written + body;
}

/**
 * Links a task into a block that is already there (P31-02), through
 * `writeProperties`, worked out against the block as it is when written so a
 * task linked a moment earlier elsewhere is kept. Null when the block already
 * links the task: nothing was written, and there is nothing to undo.
 */
export async function addTaskToBlock({
  writeProperties,
  block,
  task,
  notePaths,
}: {
  writeProperties: WriteNoteProperties;
  block: VaultPath;
  task: VaultPath;
  notePaths: readonly VaultPath[];
}): Promise<(Scheduling & { readonly kind: 'added' }) | null> {
  let added = false;
  await writeProperties({
    path: block,
    values: (properties) => {
      const tasks = blockTasksWith({ tasks: properties[BLOCK_KEYS.tasks], task, notePaths });
      added = tasks !== null;
      return tasks === null ? {} : { [BLOCK_KEYS.tasks]: tasks };
    },
  });
  return added ? { kind: 'added', block, task } : null;
}

/**
 * Takes back what a drop did. A block the drop made goes to the Trash, where
 * it can still be recovered, but only while it holds exactly what the drop
 * wrote — one edited since is left, with {@link BlockChangedError}, rather
 * than its edits lost. A task the drop linked into a block is unlinked, the
 * block's other tasks kept as written; a block that no longer links it is
 * left alone.
 */
export async function undoScheduling({
  scheduling,
  fs,
  index,
  writeProperties,
  notePaths,
}: {
  scheduling: Scheduling;
  fs: VaultFsPort;
  index: IndexPort;
  writeProperties: WriteNoteProperties;
  notePaths: readonly VaultPath[];
}): Promise<void> {
  if (scheduling.kind === 'created') {
    const { text } = await fs.readTextFile(scheduling.block);
    if (text !== scheduling.contents) throw new BlockChangedError(scheduling.block);
    await fs.trashEntry({ path: scheduling.block });
    // Safe to let go of, as deleting a note does: the refresh after every
    // change removes what is no longer on disk, so a failure only delays it.
    await forgetNotes(index, [scheduling.block]).catch(() => undefined);
    return;
  }
  const { block, task } = scheduling;
  await writeProperties({
    path: block,
    values: (properties) => {
      const tasks = blockTasksWithout({ tasks: properties[BLOCK_KEYS.tasks], task, notePaths });
      return tasks === null ? {} : { [BLOCK_KEYS.tasks]: tasks };
    },
  });
}

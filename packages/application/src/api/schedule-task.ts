import {
  LONGEST_NEW_BLOCK_MINUTES,
  messageWithoutPaths,
  newBlockLength,
  noteTitle,
  splitFrontmatter,
  TASK_TYPE,
  taskTypeOf,
  type ObjectType,
  type VaultPath,
} from '@atlas/domain';
import { NoteNameTakenError } from '../notes/create-note.ts';
import { BlockTimesError, createBlockForTask } from '../timeblocks/schedule-task.ts';
import { readTaskSchedules } from '../timeblocks/task-schedules.ts';
import { loadObjectTypes } from '../types/load-types.ts';
import { listVaultNotes } from '../vault/read-vault.ts';
import { ApiError } from './api-error.ts';
import { bodyObject, countOf, requiredString, type Fields } from './fields.ts';
import { answerWithNote, readNote } from './note-io.ts';
import { isApiNotePath, notePathFrom } from './paths.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';
import { spelledAsVault } from './vault-spelling.ts';

/**
 * Schedules a task (P31-02): a new block for it, `minutes` long from
 * `start`, linking it — what a task let go on the calendar's empty time makes
 * in the app, by the same code: made as every new note is, from the Block
 * type's template when there is one, at the top of the vault, named
 * "<task> block" and numbered when that is taken. With no `minutes`, the block
 * is as long as the task still needs, as the app sizes it. Answers 201 with
 * the block.
 */
export async function scheduleTaskRoute(request: VaultRequest): Promise<RouteResult> {
  const fields = bodyObject(request.body);
  const task = await taskOf(request, fields);
  const start = requiredString(fields, 'start');
  const types = await loadObjectTypes({ fs: request.fs, markdown: request.markdown });
  const minutes =
    fields['minutes'] === undefined
      ? await minutesStillNeeded(request, { task, types })
      : countOf(fields['minutes'], {
          field: 'minutes',
          fallback: 0,
          max: LONGEST_NEW_BLOCK_MINUTES,
        });

  request.assertStillOpen();
  try {
    const { block } = await createBlockForTask({
      fs: request.fs,
      markdown: request.markdown,
      types,
      task: { path: task, title: noteTitle(task) },
      start,
      minutes,
      notePaths: await listVaultNotes({ fs: request.fs }),
      today: request.clock.today(),
    });
    return await answerWithNote(request, { path: block, status: 201 });
  } catch (error) {
    if (error instanceof BlockTimesError) throw new ApiError('invalid', error.message);
    if (error instanceof NoteNameTakenError) throw new ApiError('conflict', error.message);
    throw error;
  }
}

/** The task the body names, as the vault spells it: refused unless it is a note of type task. */
async function taskOf(request: VaultRequest, fields: Fields): Promise<VaultPath> {
  const path = await spelledAsVault({
    fs: request.fs,
    asked: notePathFrom(requiredString(fields, 'task'), 'task'),
    accepts: isApiNotePath,
  });
  const { text } = await readNote(request, path);
  const type = request.markdown.frontmatterProperties(splitFrontmatter(text).frontmatter)['type'];
  if (typeof type !== 'string' || type.trim().toLowerCase() !== TASK_TYPE) {
    throw new ApiError('invalid', `task must be a note of type task, and ${path} is not one`);
  }
  return path;
}

/** What the task still needs set aside, as a drop in the app sizes its block. */
async function minutesStillNeeded(
  request: VaultRequest,
  { task, types }: { task: VaultPath; types: readonly ObjectType[] },
): Promise<number> {
  try {
    const schedules = await readTaskSchedules({
      index: request.index,
      paths: [task],
      taskType: taskTypeOf(types),
    });
    return newBlockLength(schedules.get(task) ?? null);
  } catch (error) {
    throw new ApiError('query_failed', messageWithoutPaths(error));
  }
}

import {
  checklistLines,
  lineContent,
  splitFrontmatter,
  TASK_TYPE,
  type ChecklistLine,
  type EditorDocument,
  type VaultPath,
} from '@atlas/domain';
import {
  LineAlreadyPromotedError,
  lineMarkdown,
  promoteChecklistLine,
  PromotionRefused,
  type ChecklistLineChoice,
} from '../checklists/promote-checklist-line.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { NoteNameTakenError } from '../notes/create-note.ts';
import { loadObjectTypes } from '../types/load-types.ts';
import { UnsavedTypingError } from '../vault/update-links.ts';
import { listVaultNotes } from '../vault/read-vault.ts';
import { ApiError } from './api-error.ts';
import { bodyObject, requiredText, type Fields } from './fields.ts';
import { notePathOf, readNote, toApiNote } from './note-io.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';

/**
 * Makes a checklist line of a note a task of its own (P30-03), as "Make task"
 * does in the app: the same use-case, so the task is made through
 * `createNote` and the line rewritten through `saveNote`, byte-preserving and
 * held to the task rules (ADR-0029). Answers both notes as they now are.
 *
 * The line is named by `text`: its words as Atlas shows them (`Ring Mara
 * Quill`), or its markdown (`Ring [[Mara Quill]]`) as the note's writer
 * writes it — the note's own spelling for links, tags and code.
 *
 * Refused, writing nothing: `not_found` when no line says `text`; `exists`
 * when the line is a task already (it starts with a link to one); `invalid`
 * when two do and `line` does not say which, or `line` is not one that says
 * it; `unsaved_in_app` when Atlas holds unsaved typing in the note; `conflict`
 * when the note changed while the task was being made — then the task this
 * request made is taken back to the Trash, so nothing is left half done.
 * There is no undo here: taking the task away is a delete, which stays in the
 * app (ADR-0016).
 */
export async function promoteLineRoute(request: VaultRequest): Promise<RouteResult> {
  const source = await notePathOf(request);
  const choice = await chosenLine(request, source, bodyObject(request.body));
  const types = await loadObjectTypes({ fs: request.fs, markdown: request.markdown });
  const notePaths = await listVaultNotes({ fs: request.fs });
  request.assertStillOpen();
  try {
    const promotion = await promoteChecklistLine({
      fs: request.fs,
      markdown: request.markdown,
      openNotes: request.openNotes,
      rng: request.rng,
      today: request.clock.today(),
      notePaths,
      taskType: types.find((type) => type.name === TASK_TYPE) ?? null,
      choice,
    });
    const answer = async (path: VaultPath) =>
      toApiNote({ markdown: request.markdown, path, contents: await readNote(request, path) });
    return {
      status: 201,
      body: { note: await answer(promotion.source), task: await answer(promotion.task) },
    };
  } catch (error) {
    throw refusalOf(error, source);
  }
}

/** The line the request names, among the note's boxes as `checklistLines` reads them. */
async function chosenLine(
  request: VaultRequest,
  source: VaultPath,
  fields: Fields,
): Promise<ChecklistLineChoice> {
  const text = requiredText(fields, 'text').trim();
  const { text: contents } = await readNote(request, source);
  const body = splitFrontmatter(contents).body;
  const doc = request.markdown.parseBody(body).doc;
  const lines = checklistLines(doc);
  const saying = lines.flatMap((line, index) =>
    says({ markdown: request.markdown, doc, line, text }) ? [index] : [],
  );
  if (saying.length === 0) {
    throw new ApiError('not_found', `No checklist line in ${source} says ${JSON.stringify(text)}`);
  }
  const line = lineAsked(fields, saying);
  return { source, line, text: lines[line]?.text ?? text };
}

/** Whether a line says `text`: its words as shown, or its markdown as written. */
function says({
  markdown,
  doc,
  line,
  text,
}: {
  markdown: MarkdownPort;
  doc: EditorDocument;
  line: ChecklistLine;
  text: string;
}): boolean {
  if (line.text === text) return true;
  return lineMarkdown({ markdown, content: lineContent(doc, line.at) }) === text;
}

/** The line among those that say the text: the one asked for, or the only one. */
function lineAsked(fields: Fields, saying: readonly number[]): number {
  const asked = fields['line'];
  if (asked === undefined) {
    if (saying.length === 1) return saying[0] as number;
    throw new ApiError(
      'invalid',
      `${saying.length} checklist lines say that; give "line", one of ${saying.join(', ')}`,
    );
  }
  if (typeof asked !== 'number' || !saying.includes(asked)) {
    throw new ApiError(
      'invalid',
      `"line" must be one of ${saying.join(', ')}, the lines that say that`,
    );
  }
  return asked;
}

function refusalOf(error: unknown, source: VaultPath): unknown {
  if (error instanceof UnsavedTypingError) {
    return new ApiError('unsaved_in_app', `${source} is open in Atlas with unsaved edits`);
  }
  if (error instanceof LineAlreadyPromotedError) return new ApiError('exists', error.message);
  if (error instanceof PromotionRefused || error instanceof NoteNameTakenError) {
    return new ApiError('conflict', error.message);
  }
  return error;
}

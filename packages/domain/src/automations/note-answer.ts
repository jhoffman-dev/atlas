/**
 * A Claude step whose output is a note (P29-03): one new note — a morning
 * brief, a weekly-review draft — in the folder its rule declares. The answer
 * names it and says what it holds; where it goes, and that it is new, is the
 * rule's and the runner's to say, never the answer's.
 */

import { cleanEntryName } from '../vault/new-note.ts';
import { noteTextProblem, propertiesProblem, unknownKeyProblem } from './answer-limits.ts';
import { answerJson, isRecord, refused, type Reading } from './proposal-schema.ts';

/** What a note answer says: the new note's name, body and properties. */
export interface NoteAnswer {
  readonly title: string;
  readonly body: string;
  readonly properties: Readonly<Record<string, NoteAnswerValue>>;
}

export type NoteAnswerValue = string | number | boolean | readonly string[];

/** What the model is told its answer must be. */
export const NOTE_ANSWER_INSTRUCTIONS = [
  'Answer with JSON only, and nothing around it:',
  '{ "note": { "title": its name, "body": its markdown, "properties": optional { key: value } } }.',
  'It is one new note. You cannot change a note that is already there.',
  'Write plain markdown: no images, embeds or HTML. Links are fine. Properties are text, numbers, true or false, or lists of text.',
].join('\n');

/** The note an answer describes, or why it does not describe one. */
export function readNoteAnswer(answer: string): Reading<NoteAnswer> {
  const parsed = answerJson(answer);
  if (!parsed.ok) return parsed;
  const note = isRecord(parsed.value) ? parsed.value['note'] : undefined;
  if (!isRecord(parsed.value) || !isRecord(note)) return refused('It is not { "note": { … } }.');
  const extra = unknownKeyProblem(parsed.value, ['note'], 'The answer');
  if (extra !== null) return refused(extra);
  const inside = unknownKeyProblem(note, ['title', 'body', 'properties'], 'Its note');
  if (inside !== null) return refused(inside);
  const title = cleanEntryName(typeof note['title'] === 'string' ? note['title'] : '');
  if (title === '') return refused('Its note has no title.');
  const body = note['body'] ?? '';
  if (typeof body !== 'string') return refused('Its note’s body is not text.');
  const properties = note['properties'] ?? {};
  const problem = noteTextProblem({ title, body }) ?? propertiesProblem(properties);
  if (problem !== null) return refused(problem);
  return {
    ok: true,
    // Plain values only: propertiesProblem has just refused anything else.
    value: { title, body, properties: properties as Readonly<Record<string, NoteAnswerValue>> },
  };
}

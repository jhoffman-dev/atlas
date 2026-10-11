/**
 * A Claude step whose output is a note (P29-03): one new note — a morning
 * brief, a weekly-review draft — in the folder its rule declares. The answer
 * names it and says what it holds; where it goes, and that it is new, is the
 * rule's and the runner's to say, never the answer's.
 */

import { cleanEntryName } from '../vault/new-note.ts';
import { setKeyProblem } from './automation-rule.ts';
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
].join('\n');

/** The note an answer describes, or why it does not describe one. */
export function readNoteAnswer(answer: string): Reading<NoteAnswer> {
  const parsed = answerJson(answer);
  if (!parsed.ok) return parsed;
  const note = isRecord(parsed.value) ? parsed.value['note'] : undefined;
  if (!isRecord(note)) return refused('It is not { "note": { … } }.');
  const title = cleanEntryName(typeof note['title'] === 'string' ? note['title'] : '');
  if (title === '') return refused('Its note has no title.');
  const body = note['body'] ?? '';
  if (typeof body !== 'string') return refused('Its note’s body is not text.');
  const properties = readProperties(note['properties'] ?? {});
  if (!properties.ok) return properties;
  return { ok: true, value: { title, body, properties: properties.value } };
}

function readProperties(value: unknown): Reading<Record<string, NoteAnswerValue>> {
  if (!isRecord(value)) return refused('Its note’s properties are not keys and values.');
  const read: Record<string, NoteAnswerValue> = {};
  for (const [key, each] of Object.entries(value)) {
    const problem = setKeyProblem(key);
    if (problem !== null) return refused(problem);
    if (!isPlain(each)) return refused(`“${key}” is not text, a number, true or false, or a list.`);
    read[key] = each;
  }
  return { ok: true, value: read };
}

function isPlain(value: unknown): value is NoteAnswerValue {
  if (Array.isArray(value)) return value.every((item) => typeof item === 'string');
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

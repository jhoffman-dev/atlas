import { cappedJson, mostThatFit } from './capped-json.ts';

/**
 * A note as atlas_read_note hands it to the model (#415): whole when it fits,
 * else one page of its body from `offset`, with a `page` that says how much
 * is left and the offset to ask for next. A long note is never cut without
 * a way to read on.
 */

/**
 * The most one read answers, far above a normal note (a few thousand), so a
 * note is read whole but one huge note still cannot fill the model's context.
 */
export const NOTE_READ_CHARACTERS = 80_000;

interface NoteAnswer {
  readonly note: { readonly body: string } & Readonly<Record<string, unknown>>;
}

export interface NotePage {
  readonly offset: number;
  readonly shown: number;
  readonly of: number;
  readonly remaining: number;
  readonly next: number | null;
  readonly note: string;
}

/** The answer the model is shown; an `invalid` refusal for an offset past the end. */
export function notePageAnswer(
  answer: NoteAnswer,
  offset: number,
): { content: string; isError: boolean } {
  const { body } = answer.note;
  if (offset > 0 && offset >= body.length) {
    return {
      content: `invalid: offset ${offset} is past the end of the body, which is ${body.length} characters.`,
      isError: true,
    };
  }
  const whole = JSON.stringify(answer);
  if (offset === 0 && whole.length <= NOTE_READ_CHARACTERS)
    return { content: whole, isError: false };
  const paged = (count: number) => JSON.stringify(pageOf(answer, offset, count));
  const most = mostThatFit(body.length - offset, (n) => paged(n).length <= NOTE_READ_CHARACTERS);
  // Not even an empty page fits: the properties alone are too long, cut and said to be.
  if (most === null) return { content: cappedJson(answer, NOTE_READ_CHARACTERS), isError: false };
  return { content: paged(cleanEnd(body, offset, most)), isError: false };
}

function pageOf(
  answer: NoteAnswer,
  offset: number,
  count: number,
): NoteAnswer & { page: NotePage } {
  const { body } = answer.note;
  const end = offset + count;
  const remaining = body.length - end;
  const next = remaining > 0 ? end : null;
  const note =
    next === null
      ? `The body is ${grouped(body.length)} characters; this page is the end of it.`
      : `The body is ${grouped(body.length)} characters; this page shows ${grouped(offset)} to ` +
        `${grouped(end)}, and ${grouped(remaining)} remain. Call atlas_read_note with the same ` +
        `path and offset ${next} to read on.`;
  return {
    ...answer,
    note: { ...answer.note, body: body.slice(offset, end) },
    page: { offset, shown: count, of: body.length, remaining, next, note },
  };
}

/**
 * How many characters a page keeps: ending at a line break when one is in its
 * second half, so a page does not end mid-line, and never between the two
 * halves of a character.
 */
function cleanEnd(body: string, offset: number, most: number): number {
  if (offset + most >= body.length) return most;
  const lineEnd = body.lastIndexOf('\n', offset + most - 1) + 1 - offset;
  if (lineEnd > most / 2) return lineEnd;
  const code = body.charCodeAt(offset + most - 1);
  const splitsAPair = code >= 0xd800 && code <= 0xdbff;
  return splitsAPair && most > 1 ? most - 1 : most;
}

const grouped = (count: number) => count.toLocaleString('en-US');

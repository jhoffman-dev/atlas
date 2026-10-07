import { blockIdAtEnd, isBlockId } from '../markdown/block-anchor.ts';
import { bodyError, type MeetingImportError } from './meeting-import-error.ts';
import { numberedLines, readFences, type NumberedLine } from './meeting-lines.ts';

/** The block id a line ends with — after words, or alone as `^id` — or null. */
function idOnLine(text: string): string | null {
  const alone = text.trim();
  if (alone.startsWith('^') && isBlockId(alone.slice(1))) return alone.slice(1);
  return blockIdAtEnd(text)?.id ?? null;
}

/** The lines of the body that hold transcript turns: those under its heading. */
export interface TranscriptLines {
  readonly first: number;
  readonly last: number;
}

/**
 * An error for every block id written twice in a meeting's body where at
 * least one of the two is outside the transcript: a Summary paragraph, a
 * next step or a heading that shares a turn's id would take its citations
 * (ADR-0022). Two turns sharing one are the transcript's to report.
 */
export function sharedBlockIdErrors(
  body: string,
  {
    firstLine,
    transcript,
  }: { readonly firstLine: number; readonly transcript: TranscriptLines | null },
): MeetingImportError[] {
  const lines = numberedLines(body, firstLine);
  const { fenced } = readFences(lines);
  const inTranscript = ({ line }: NumberedLine) =>
    transcript !== null && line >= transcript.first && line <= transcript.last;
  const seen = new Map<string, NumberedLine>();
  const errors: MeetingImportError[] = [];
  lines.forEach((each, index) => {
    const id = fenced[index] === true ? null : idOnLine(each.text);
    if (id === null) return;
    const earlier = seen.get(id);
    if (earlier === undefined) seen.set(id, each);
    else if (!inTranscript(earlier) || !inTranscript(each)) {
      const message = `Line ${each.line}: ^${id} is already the id of line ${earlier.line} — a block id is used once in the file`;
      errors.push(bodyError('Block id', message, each.line));
    }
  });
  return errors;
}

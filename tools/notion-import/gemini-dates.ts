import type { MeetingFields } from '../n8n/meeting-to-atlas.ts';
import { readTranscript } from '../n8n/meeting-transcript.ts';

/** The provider whose Notion Date is not when the meeting started (issue #44). */
export const GEMINI = 'gemini';

/**
 * How a Gemini row's Date is read. The only way offered is `arrival-local`:
 * the Date is when Gemini's notes arrived, written as local time with a `Z`
 * on it (issue #44). With no way chosen, Gemini rows are held, not guessed.
 */
export type GeminiDates = 'arrival-local';

export const GEMINI_DATES: readonly GeminiDates[] = ['arrival-local'];

/** A date and a time, any seconds and any zone or offset after them, which this reading ignores. */
const WRITTEN_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/i;

const two = (value: number) => String(value).padStart(2, '0');

const seconds = (time: string) =>
  time.split(':').reduce((total, part) => total * 60 + Number(part), 0);

/** The transcript's last section stamp, `hh:mm:ss` from the start of the recording: how long it ran, near enough. */
function transcriptLength(transcript: unknown): string | null {
  const { turns, clock } = readTranscript(transcript);
  if (clock !== 'elapsed') return null;
  return turns.findLast((turn) => turn.time !== null)?.time ?? null;
}

/** The clock time `back` seconds before the written day and time, as a day and `HH:MM` (it may be the day before). */
function earlier(written: RegExpExecArray, back: number): { date: string; start: string } {
  const [, year, month, day, hours, minutes] = written.map(Number);
  const at = new Date(
    Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hours, minutes) - back * 1000,
  );
  return {
    date: `${at.getUTCFullYear()}-${two(at.getUTCMonth() + 1)}-${two(at.getUTCDate())}`,
    start: `${two(at.getUTCHours())}:${two(at.getUTCMinutes())}`,
  };
}

/** What the meeting's Notes say about its start, so nobody takes it for the real one. */
function estimateNote(arrived: string, length: string | null): string {
  const how =
    length === null
      ? 'the transcript has no time stamps, so the start written here is that time'
      : `the start written here is that less the transcript's last time stamp, ${length}`;
  return `Start time approximate: Gemini's date in Notion is when its notes arrived (${arrived}), and ${how} (issue #44).`;
}

/**
 * A Gemini row's fields with its Date read as issue #44 describes it: the
 * written time is local wall-clock time (its `Z` or offset ignored), and it
 * is when the notes arrived, near the meeting's end. The start is that less
 * the transcript's length, when the transcript has section stamps, and Notes
 * open with a line saying the start is approximate (meeting/v1 has no field
 * for it). The end is left out: the Date says nothing about it. A Date that
 * is not a date and a time is left for the mapper to refuse.
 */
export function fromArrival(fields: MeetingFields): MeetingFields {
  const written = typeof fields.date === 'string' ? WRITTEN_TIME.exec(fields.date.trim()) : null;
  if (written === null) return fields;
  const length = transcriptLength(fields.transcript);
  const { date, start } = earlier(written, length === null ? 0 : seconds(length));
  const note = estimateNote(`${written[4]}:${written[5]}`, length);
  const details = typeof fields.details === 'string' ? fields.details.trim() : '';
  return {
    ...fields,
    date,
    start,
    end: null,
    details: details === '' ? note : `${note}\n\n${details}`,
  };
}

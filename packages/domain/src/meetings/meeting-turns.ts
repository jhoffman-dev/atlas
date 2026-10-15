import { splitFrontmatter } from '../markdown/markdown-document.ts';
import { splitMeetingSections, type MeetingSectionName } from './meeting-sections.ts';
import { parseProviderNextSteps, type ProviderNextStep } from './next-steps.ts';
import { parseTranscript, type TranscriptTurn } from './transcript.ts';

/**
 * A meeting note's transcript turns and its provider's next steps, read
 * leniently from its text as it is now (P29-05): the import held the file to
 * the contract when it arrived, but a note may be edited since — or shown in
 * part — and what still reads as a turn is still what was said. A line that
 * does not read is left out, never guessed at.
 */

/** The text under one of the body's sections, and the body line it starts on; null when it has none. */
function sectionOf(
  text: string,
  name: MeetingSectionName,
): { text: string; firstLine: number } | null {
  const { sections } = splitMeetingSections(splitFrontmatter(text).body, 1);
  const found = sections.find((section) => section.name === name);
  return found === undefined ? null : { text: found.text, firstLine: found.headingLine + 1 };
}

/** The turns of the note's Transcript section that read as turns; a speaker written `You` is the owner. */
export function meetingTurnsOf(text: string): readonly TranscriptTurn[] {
  const section = sectionOf(text, 'transcript');
  if (section === null) return [];
  return parseTranscript(section.text, { selfName: null, firstLine: section.firstLine }).turns;
}

/** The words under the note's Transcript heading, every byte as written; null when it has none. */
export function meetingTranscriptOf(text: string): string | null {
  return sectionOf(text, 'transcript')?.text ?? null;
}

/** The provider's own next steps, as its section lists them. */
export function providerNextStepsOf(text: string): readonly ProviderNextStep[] {
  const section = sectionOf(text, 'nextSteps');
  return section === null ? [] : parseProviderNextSteps(section.text, section.firstLine).steps;
}

/** Where one section of a meeting note sits in its text, as character offsets. */
export interface MeetingSectionBounds {
  readonly name: MeetingSectionName;
  /** Where its `## Heading` line starts. */
  readonly headingStart: number;
  /** Where the text under the heading starts: after the heading's line break. */
  readonly textStart: number;
  /** Where it ends: where the next section's heading starts, or the end of the note. */
  readonly textEnd: number;
}

/**
 * The sections of a meeting note and where each lies in `text`, found by the
 * same reader the import's contract uses (`splitMeetingSections`) — so a
 * `## Transcript` inside a code fence is no heading here either.
 */
export function meetingSectionBounds(text: string): MeetingSectionBounds[] {
  const { body } = splitFrontmatter(text);
  if (!text.endsWith(body)) return [];
  const lines = body.split('\n');
  const starts: number[] = [];
  let at = text.length - body.length;
  for (const line of lines) {
    starts.push(at);
    at += line.length + 1;
  }
  const { sections } = splitMeetingSections(body, 1);
  return sections.map((section, index) => {
    const headingStart = starts[section.headingLine - 1] ?? text.length;
    const heading = lines[section.headingLine - 1] ?? '';
    const next = sections[index + 1];
    return {
      name: section.name,
      headingStart,
      textStart: Math.min(text.length, headingStart + heading.length + 1),
      textEnd: next === undefined ? text.length : (starts[next.headingLine - 1] ?? text.length),
    };
  });
}

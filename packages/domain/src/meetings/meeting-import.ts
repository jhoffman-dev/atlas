import { splitFrontmatter } from '../markdown/markdown-document.ts';
import { readMeetingHeader, type MeetingHeader, type TranscriptClock } from './meeting-header.ts';
import { sharedBlockIdErrors, type TranscriptLines } from './meeting-block-ids.ts';
import { frontmatterError, type MeetingImportError } from './meeting-import-error.ts';
import { splitMeetingSections, type MeetingSection } from './meeting-sections.ts';
import { parseProviderNextSteps, type ProviderNextStep } from './next-steps.ts';
import { parseTranscript, type TranscriptTurn } from './transcript.ts';

/** A meeting file that follows meeting/v1, read. */
export interface MeetingImport extends MeetingHeader {
  /** The Summary section as written, or null when there is none. */
  readonly summary: string | null;
  /** The Notes section (Gemini's Details) as written, or null. */
  readonly notes: string | null;
  readonly nextSteps: readonly ProviderNextStep[];
  readonly transcript: readonly TranscriptTurn[];
}

export type MeetingImportResult =
  | { readonly ok: true; readonly meeting: MeetingImport }
  | { readonly ok: false; readonly errors: readonly MeetingImportError[] };

/** A frontmatter block read as YAML: its values, or why it could not be read. */
export interface FrontmatterReading {
  readonly properties: Readonly<Record<string, unknown>>;
  /** Why the YAML could not be read, in one line; null when it could. */
  readonly problem: string | null;
}

export interface MeetingImportSource {
  /** The whole file. */
  readonly text: string;
  /**
   * Reads a frontmatter block, delimiters and all. The domain has no YAML
   * parser, so the caller hands in the one the app reads every note with.
   */
  readonly readFrontmatter: (frontmatter: string) => FrontmatterReading;
  /** The profile's name, which `You` in a transcript stands for (ADR-0024); null or blank when unset. */
  readonly selfName: string | null;
}

interface MeetingBody {
  readonly summary: string | null;
  readonly notes: string | null;
  readonly nextSteps: readonly ProviderNextStep[];
  readonly transcript: readonly TranscriptTurn[];
}

function readHeader(
  frontmatter: string | null,
  readFrontmatter: MeetingImportSource['readFrontmatter'],
): { readonly header: MeetingHeader | null; readonly errors: readonly MeetingImportError[] } {
  if (frontmatter === null) {
    const message = 'The file has no frontmatter: it must open with a `---` block';
    return { header: null, errors: [frontmatterError('frontmatter', message)] };
  }
  const { properties, problem } = readFrontmatter(frontmatter);
  if (problem !== null) {
    const message = `The frontmatter is not readable YAML: ${problem}`;
    return { header: null, errors: [frontmatterError('frontmatter', message)] };
  }
  return readMeetingHeader(properties);
}

const sectionOf = (sections: readonly MeetingSection[], name: MeetingSection['name']) =>
  sections.find((section) => section.name === name) ?? null;

/** The file lines a section's text spans, below its heading. */
const linesOf = ({ headingLine, text }: MeetingSection): TranscriptLines => ({
  first: headingLine + 1,
  last: headingLine + text.split('\n').length,
});

interface BodyContext {
  readonly firstLine: number;
  readonly selfName: string | null;
  readonly clock: TranscriptClock;
}

function readBody(
  body: string,
  { firstLine, selfName, clock }: BodyContext,
): { readonly body: MeetingBody; readonly errors: readonly MeetingImportError[] } {
  const { sections, errors } = splitMeetingSections(body, firstLine);
  const steps = sectionOf(sections, 'nextSteps');
  const transcript = sectionOf(sections, 'transcript');
  const nextSteps =
    steps === null ? null : parseProviderNextSteps(steps.text, steps.headingLine + 1);
  const turns =
    transcript === null
      ? null
      : parseTranscript(transcript.text, {
          selfName,
          clock,
          firstLine: transcript.headingLine + 1,
        });
  const transcriptLines = transcript === null ? null : linesOf(transcript);
  const sharedIds = sharedBlockIdErrors(body, { firstLine, transcript: transcriptLines });
  return {
    body: {
      summary: sectionOf(sections, 'summary')?.text ?? null,
      notes: sectionOf(sections, 'notes')?.text ?? null,
      nextSteps: nextSteps?.steps ?? [],
      transcript: turns?.turns ?? [],
    },
    errors: [...errors, ...(nextSteps?.errors ?? []), ...(turns?.errors ?? []), ...sharedIds],
  };
}

/** The 1-based line `offset` falls on in `text`. */
const lineAt = (text: string, offset: number) => text.slice(0, offset).split('\n').length;

/**
 * Whether a meeting file follows the meeting import contract v1 (ADR-0027,
 * `vault/docs/contracts/meeting-import-v1.md`): the meeting it holds, or every
 * way it does not — each missing key named, each bad line numbered. Nothing
 * is fixed or filled in: a file that is wrong is reported, as it is.
 */
export function validateMeetingImport({
  text,
  readFrontmatter,
  selfName,
}: MeetingImportSource): MeetingImportResult {
  const document = splitFrontmatter(text);
  const header = readHeader(document.frontmatter, readFrontmatter);
  const firstLine = lineAt(text, document.bodyOffset);
  // An empty profile name is no name: `You` stays unnamed rather than blank.
  const owner = selfName === null || selfName.trim() === '' ? null : selfName;
  const clock = header.header?.transcriptClock ?? 'elapsed';
  const body = readBody(document.body, { firstLine, selfName: owner, clock });
  const errors = [...header.errors, ...body.errors];
  if (header.header === null || errors.length > 0) return { ok: false, errors };
  return { ok: true, meeting: { ...header.header, ...body.body } };
}

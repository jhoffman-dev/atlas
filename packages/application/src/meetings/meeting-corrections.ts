import {
  canCorrect,
  correctionProperties,
  correctMeetingBody,
  MEETING_TYPE,
  noteTitle,
  NOTHING_CORRECTED_PROPERTIES,
  recordedCorrections,
  splitFrontmatter,
  UNDONE_CORRECTION_PROPERTIES,
  undoMeetingCorrections,
  wasCorrected,
  type CorrectionRecord,
  type VaultPath,
  type Vocabulary,
} from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { loadTerms } from '../terms/terms.ts';
import { UnsavedTypingError } from '../vault/update-links.ts';
import { readFrontmatter } from './meeting-reading.ts';
import { writeStamp, type StampPorts } from './meeting-stamp-writer.ts';

/** A meeting's words not corrected, or its corrections not undone, for a reason the person is told. */
export class CorrectionRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'CorrectionRefusedError';
  }
}

/** What correcting a meeting's words reaches: the note, its panes, and the index the vocabulary is read from. */
export type MeetingCorrectionPorts = StampPorts & { readonly index: Pick<IndexPort, 'query'> };

/**
 * What a meeting is written with once its words were read: its frontmatter's
 * change list, and its body. With nothing corrected (`count` 0) the values
 * only mark it read, and the body is the one it had.
 */
export interface CorrectedMeeting {
  readonly values: Readonly<Record<string, unknown>>;
  readonly body: string;
  readonly records: readonly CorrectionRecord[];
  readonly count: number;
}

/**
 * A meeting's words corrected by the vocabulary (P28-06), as the note is to
 * be written; null when it was read before — corrected, undone or found
 * clean — or the vocabulary has no misheard spelling, so it is never written
 * for nothing. A meeting with nothing to correct comes back with `count` 0 and
 * the mark that says so, for the import to write in the same stamp, so the
 * pipeline step does not read it again on every run.
 */
export function correctedMeeting({
  markdown,
  text,
  vocabulary,
}: {
  markdown: MarkdownPort;
  text: string;
  vocabulary: Pick<Vocabulary, 'entries'> & Partial<Pick<Vocabulary, 'speakers'>>;
}): CorrectedMeeting | null {
  const document = splitFrontmatter(text);
  if (wasCorrected(readFrontmatter(markdown, document.frontmatter).properties)) return null;
  if (!canCorrect(vocabulary)) return null;
  const correction = correctMeetingBody(document.body, vocabulary);
  if (correction.count === 0) {
    return { values: NOTHING_CORRECTED_PROPERTIES, body: document.body, records: [], count: 0 };
  }
  return {
    values: correctionProperties(correction),
    body: correction.body,
    records: correction.records,
    count: correction.count,
  };
}

/**
 * A meeting's text as it reads once its words are corrected: what a step that
 * runs before the import's stamp write reads, so it sees the names the
 * meeting arrives with — a misheard speaker as the person the vocabulary says
 * it is. A meeting read before (corrected, undone or found clean) is as it
 * is, and the vocabulary is not asked for. Nothing is written.
 *
 * `vocabulary` is the one the caller's run already read, so the text is
 * corrected here by the very spellings its stamp write will use; without one,
 * it is read from the index.
 */
export async function meetingTextAsCorrected({
  ports,
  text,
  vocabulary: given,
}: {
  ports: Pick<MeetingCorrectionPorts, 'markdown' | 'index'>;
  text: string;
  vocabulary?: Vocabulary | undefined;
}): Promise<string> {
  const { frontmatter } = splitFrontmatter(text);
  if (wasCorrected(readFrontmatter(ports.markdown, frontmatter).properties)) return text;
  const vocabulary = given ?? (await loadTerms({ index: ports.index })).vocabulary;
  const corrected = correctedMeeting({ markdown: ports.markdown, text, vocabulary });
  if (corrected === null || corrected.count === 0) return text;
  return (frontmatter ?? '') + corrected.body;
}

/** What correcting one meeting did: the change list it holds, and whether this call wrote it. */
export interface MeetingTermsCorrection {
  readonly records: readonly CorrectionRecord[];
  readonly written: boolean;
}

/**
 * Corrects one meeting's words by the vault's vocabulary: the declared,
 * deterministic step the "after a meeting" pipeline (P29-06) runs, as the
 * import does when a meeting arrives. A meeting corrected before — or whose
 * corrections were undone — is not corrected again, and the change list it
 * holds is returned; one with nothing to correct is not written here, since
 * only the import's own stamp write can carry the "read, nothing to correct"
 * mark for free — so this step reads such a meeting again on its next run.
 */
export async function correctMeetingTerms({
  ports,
  path,
}: {
  ports: MeetingCorrectionPorts;
  path: VaultPath;
}): Promise<MeetingTermsCorrection> {
  const { text, modified } = await ports.fs.readTextFile(path);
  const { properties } = readFrontmatter(ports.markdown, splitFrontmatter(text).frontmatter);
  if (properties['type'] !== MEETING_TYPE) {
    throw new CorrectionRefusedError(
      `${noteTitle(path)} is not a meeting, so nothing was corrected.`,
    );
  }
  if (wasCorrected(properties))
    return { records: recordedCorrections(properties) ?? [], written: false };
  const { vocabulary } = await loadTerms({ index: ports.index });
  const corrected = correctedMeeting({ markdown: ports.markdown, text, vocabulary });
  if (corrected === null || corrected.count === 0) return { records: [], written: false };
  const { values, body } = corrected;
  const unsaved = await writeStamp(ports, { path, modified, values, body });
  if (unsaved !== null) throw new UnsavedTypingError(path);
  return { records: corrected.records, written: true };
}

/**
 * Puts back the words a meeting's correction changed, every byte as it was,
 * and marks the corrections undone so they are never made again. Refused —
 * nothing written — when the meeting's body changed since it was corrected,
 * or it is open with unsaved typing.
 */
export async function undoMeetingTermCorrections({
  ports,
  path,
}: {
  ports: StampPorts;
  path: VaultPath;
}): Promise<void> {
  const { text, modified } = await ports.fs.readTextFile(path);
  const document = splitFrontmatter(text);
  const { properties } = readFrontmatter(ports.markdown, document.frontmatter);
  const undone = undoMeetingCorrections({ body: document.body, properties });
  if (!undone.ok) throw new CorrectionRefusedError(undone.reason);
  const unsaved = await writeStamp(ports, {
    path,
    modified,
    values: UNDONE_CORRECTION_PROPERTIES,
    body: undone.body,
  });
  if (unsaved !== null) throw new UnsavedTypingError(path);
}

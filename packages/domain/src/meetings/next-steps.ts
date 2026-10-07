import { bodyError, type MeetingImportError } from './meeting-import-error.ts';
import { numberedLines, withoutBlockId, type NumberedLine } from './meeting-lines.ts';

/** How sure the provider was of a next step, when it says (Granola does). */
export type StepConfidence = 'high' | 'medium' | 'low';

/**
 * A next step as the provider wrote it: `- [Owner] Title: description`.
 * The provider's, not Atlas's — what becomes a task is decided later.
 */
export interface ProviderNextStep {
  /** Who the provider said owns it, as written; null when it named nobody. */
  readonly owner: string | null;
  readonly text: string;
  readonly confidence: StepConfidence | null;
  readonly blockId: string | null;
  readonly line: number;
}

const FIELD = 'Provider next steps';
const BULLET = /^[-*][ \t]+/;
/** Anchored on its literal `(`, so a long run of spaces is not re-scanned. */
const CONFIDENCE = /\(confidence:[ \t]*(high|medium|low)\)\.?$/i;
/** `[x]` and `[X]` are a ticked task-list checkbox, never an owner called x. */
const TICKED = /^[xX]$/;

/**
 * Where the owner's brackets close in `text`, which opens with `[`: the
 * matching `]`, counting the brackets inside (`[Mara [PM]]`), or the end of
 * a wikilink (`[[Mara Quill]]`); -1 when they never close.
 */
function ownerEnd(text: string): number {
  if (text.startsWith('[[')) {
    const close = text.indexOf(']]');
    return close === -1 ? -1 : close + 2;
  }
  let depth = 0;
  for (let at = 0; at < text.length; at += 1) {
    if (text[at] === '[') depth += 1;
    else if (text[at] === ']' && --depth === 0) return at + 1;
  }
  return -1;
}

/**
 * The owner a step's text opens with, and the text after it. The owner is
 * what is between the brackets, or a wikilink as written. Brackets not
 * followed by a space are the step's own words (`[docs](url)`).
 */
function splitOwner(text: string): { readonly owner: string | null; readonly rest: string } {
  const end = text.startsWith('[') ? ownerEnd(text) : -1;
  if (end === -1 || !/^[ \t]/.test(text.slice(end))) return { owner: null, rest: text };
  const owner = text.startsWith('[[') ? text.slice(0, end) : text.slice(1, end - 1);
  return { owner, rest: text.slice(end) };
}

/** The step's words and the confidence written at their end, if any. */
function splitConfidence(written: string): {
  readonly words: string;
  readonly confidence: StepConfidence | null;
} {
  const match = CONFIDENCE.exec(written);
  const before = match === null ? undefined : written[match.index - 1];
  if (match === null || (before !== undefined && before !== ' ' && before !== '\t')) {
    return { words: written.trim(), confidence: null };
  }
  const confidence = (match[1]?.toLowerCase() as StepConfidence | undefined) ?? null;
  return { words: written.slice(0, match.index).trim(), confidence };
}

function readStep({ text, line }: NumberedLine): ProviderNextStep | MeetingImportError {
  const { rest, blockId } = withoutBlockId(text);
  const item = rest.trim();
  const bullet = BULLET.exec(item);
  if (bullet === null) {
    return bodyError(FIELD, `Line ${line} is not a \`- [Owner] Title: description\` item`, line);
  }
  const { owner, rest: written } = splitOwner(item.slice(bullet[0].length));
  if (owner?.trim() === '') return bodyError(FIELD, `Line ${line}: the owner is blank`, line);
  if (owner !== null && TICKED.test(owner)) {
    const message = `Line ${line}: [${owner}] is a checkbox, not an owner — leave the owner out`;
    return bodyError(FIELD, message, line);
  }
  const { words, confidence } = splitConfidence(written);
  if (words === '') return bodyError(FIELD, `Line ${line}: the step says nothing`, line);
  return { owner: owner?.trim() ?? null, text: words, confidence, blockId, line };
}

const isError = (each: ProviderNextStep | MeetingImportError): each is MeetingImportError =>
  'message' in each;

/** A Provider next steps section's items, one per line, or why a line is not one. */
export function parseProviderNextSteps(
  section: string,
  firstLine: number,
): { readonly steps: readonly ProviderNextStep[]; readonly errors: readonly MeetingImportError[] } {
  const readings = numberedLines(section, firstLine)
    .filter((each) => each.text.trim() !== '')
    .map(readStep);
  return {
    steps: readings.filter((each): each is ProviderNextStep => !isError(each)),
    errors: readings.filter(isError),
  };
}

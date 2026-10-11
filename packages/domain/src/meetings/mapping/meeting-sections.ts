import { fencedLines, textLines } from './meeting-text.ts';

/** The four parts of a provider's notes the mapper reads as fields of their own. */
export interface NotesSections {
  readonly summary: string;
  readonly decisions: string;
  readonly nextSteps: string;
  readonly details: string;
}

type SectionName = keyof NotesSections;

/** A heading that names one of the four, at any level, alone on its line (Gemini's `## Next steps`). */
const SECTION_HEADING =
  /^ {0,3}#{1,6}[ \t]+(summary|decisions|next steps|details)(?:[ \t]+#+)?[ \t]*$/i;

const NAMES: Readonly<Record<string, SectionName>> = {
  summary: 'summary',
  decisions: 'decisions',
  'next steps': 'nextSteps',
  details: 'details',
};

/** The section a line opens, or null when it opens none (code never does). */
function opens(text: string, code: boolean): SectionName | null {
  if (code) return null;
  const name = SECTION_HEADING.exec(text)?.[1];
  return name === undefined ? null : (NAMES[name.toLowerCase()] ?? null);
}

/**
 * A provider's notes as one markdown text — Gemini's, as a workflow hands
 * them over: `## Summary`, `## Decisions`, `## Next steps`, `## Details` —
 * split into those four. Text before the first such heading is summary; a
 * heading named twice gathers both; any other heading stays in the section it
 * is in. A heading inside a code fence opens nothing.
 */
export function splitSections(value: unknown): NotesSections {
  const gathered: Record<SectionName, string[]> = {
    summary: [],
    decisions: [],
    nextSteps: [],
    details: [],
  };
  let current: SectionName = 'summary';
  for (const { text, code } of fencedLines(textLines(value, 'sections')).lines) {
    const opened = opens(text, code);
    if (opened === null) gathered[current].push(text);
    else current = opened;
  }
  const joined = (name: SectionName) => {
    const text = gathered[name].join('\n');
    return text.trim() === '' ? '' : text;
  };
  return {
    summary: joined('summary'),
    decisions: joined('decisions'),
    nextSteps: joined('nextSteps'),
    details: joined('details'),
  };
}

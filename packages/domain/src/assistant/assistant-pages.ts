import { linkedPageType } from '../linked-pages/linked-sections.ts';
import { MEETING_TYPE } from '../meetings/meeting-header.ts';
import { COMPANY_TYPE } from '../people/company.ts';
import { PERSON_TYPE } from '../people/person.ts';
import { ALIASES_KEY } from '../terms/term.ts';
import { AREA_TYPE, PROJECT_TYPE } from '../types/para.ts';

/*
 * Which notes each of the assistant's tools answers about (P32-04). Each is a
 * linked page (P30-06), so its answer is read from the sections the page
 * already shows: a brief for anything with a page of its own, open loops for
 * what work is filed or waited on, and meetings for what meetings are held.
 */

export type AssistantTool = 'brief' | 'open-loops' | 'meetings';

const PAGES: Readonly<Record<AssistantTool, readonly string[]>> = {
  brief: [PERSON_TYPE, COMPANY_TYPE, PROJECT_TYPE, AREA_TYPE, MEETING_TYPE],
  'open-loops': [PERSON_TYPE, COMPANY_TYPE, PROJECT_TYPE, AREA_TYPE],
  meetings: [PERSON_TYPE, COMPANY_TYPE, PROJECT_TYPE, AREA_TYPE],
};

const LABELS: Readonly<Record<string, string>> = {
  [PERSON_TYPE]: 'Person',
  [COMPANY_TYPE]: 'Company',
  [PROJECT_TYPE]: 'Project',
  [AREA_TYPE]: 'Area',
  [MEETING_TYPE]: 'Meeting',
};

/** The types a tool answers about, as linked pages spell them. */
export function assistantPageTypes(tool: AssistantTool): readonly string[] {
  return PAGES[tool];
}

/** Why a tool cannot answer about a note of this type, or null when it can. */
export function assistantPageRefusal(tool: AssistantTool, typeName: string | null): string | null {
  const types = PAGES[tool];
  if (typeName !== null && types.includes(linkedPageType(typeName))) return null;
  const named = types.map((type) => LABELS[type] ?? type);
  const list = `${named.slice(0, -1).join(', ')} or ${named.at(-1) ?? ''}`;
  const what = typeName === null ? 'a note with no type' : `a ${typeName} note`;
  return `entity must be a ${list} note; this is ${what}`;
}

/** Whether a page's turns are its own words: only a person speaks in a transcript. */
export function speaksInMeetings(typeName: string): boolean {
  return linkedPageType(typeName) === PERSON_TYPE;
}

/**
 * The names a person is written by in a transcript: the note's title and
 * each of its `aliases` (P28-05), blanks left out, each once.
 */
export function namesOf(title: string, frontmatter: Readonly<Record<string, unknown>>): string[] {
  const aliases = frontmatter[ALIASES_KEY];
  const written = Array.isArray(aliases) ? aliases : [aliases];
  const names = [title, ...written.filter((alias): alias is string => typeof alias === 'string')]
    .map((name) => name.trim())
    .filter((name) => name !== '');
  return [...new Set(names)];
}

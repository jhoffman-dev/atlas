import { jsonNote } from './automation-vault.ts';

/** A meeting's frontmatter as the meeting import contract v1 has it (ADR-0027). */
export const MEETING_HEADER: Readonly<Record<string, unknown>> = {
  type: 'meeting',
  atlas_import: 'meeting/v1',
  title: 'Standup',
  date: '2026-10-06',
  start: '09:30',
  provider: 'gemini',
  external_id: 'gemini-7f3a9c21',
  attendees: [{ name: 'Mara Quill', email: 'mara.quill@example.com' }],
};

/** A meeting's body as the contract has it: a summary, and a transcript of citable turns. */
export const MEETING_BODY = [
  '',
  '## Summary',
  '',
  'Larkspur Payroll go-live moves a week.',
  '',
  '## Transcript',
  '',
  '**Mara Quill** [~00:00:00] Morning, Tobias. ^t0001',
  '',
  '**Tobias Fenn** [~00:00:05] Morning. ^t0002',
  '',
].join('\n');

/** A meeting file with JSON frontmatter, as `jsonMarkdown` reads it: valid unless the header says otherwise. */
export const meetingFile = (header: Readonly<Record<string, unknown>> = MEETING_HEADER): string =>
  jsonNote({ ...header }, MEETING_BODY);

/** The header without one of its keys. */
export const meetingHeaderWithout = (key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(MEETING_HEADER).filter(([each]) => each !== key));

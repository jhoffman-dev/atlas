import { describe, expect, it } from 'vitest';
import { splitMeetingSections } from './meeting-sections.ts';

describe('a meeting body’s sections', () => {
  it('are found by their headings, each holding its text byte for byte', () => {
    const body = '# Title\n\n## Summary\n\nShort.\r\n\n## Provider next steps ##\n- [A] do\n';
    const { sections, errors } = splitMeetingSections(body, 7);
    expect(errors).toEqual([]);
    expect(sections).toEqual([
      { name: 'summary', text: '\nShort.\r\n', headingLine: 9 },
      { name: 'nextSteps', text: '- [A] do\n', headingLine: 13 },
    ]);
  });

  it('are matched without regard to case', () => {
    const { sections } = splitMeetingSections('## TRANSCRIPT\n**A** hi ^t1', 1);
    expect(sections.map((section) => section.name)).toEqual(['transcript']);
  });

  it('ignore a heading inside fenced code, and deeper headings that name no section', () => {
    const body = '## Notes\n```\n## Transcript\n```\n### Decisions\n';
    const { sections, errors } = splitMeetingSections(body, 1);
    expect(errors).toEqual([]);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.text).toBe('```\n## Transcript\n```\n### Decisions\n');
  });

  it('report a heading the contract does not name, one twice, and one out of order', () => {
    const body =
      '## Notes\n\n## Action items\n\n## Notes\n\n## Summary\n\n## Transcript\n**A** hi ^t1';
    const { sections, errors } = splitMeetingSections(body, 1);
    expect(sections.map((section) => section.name)).toEqual(['notes', 'transcript']);
    expect(errors.map(({ in: where, field, line }) => [where, field, line])).toEqual([
      ['body', 'Action items', 3],
      ['body', 'Notes', 5],
      ['body', 'Summary', 7],
    ]);
    expect(errors.map((error) => error.message)).toEqual([
      expect.stringMatching(/is not a meeting\/v1 section/),
      expect.stringMatching(/appears twice/),
      expect.stringMatching(/out of order/),
    ]);
  });
});

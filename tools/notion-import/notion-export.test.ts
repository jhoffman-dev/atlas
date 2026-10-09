import { describe, expect, it } from 'vitest';
import { CsvError, readCsv } from './notion-csv.ts';
import { notionWhen } from './notion-date.ts';
import { pageSections, readNotionPage } from './notion-page.ts';

/* Reading Notion's "Markdown & CSV" export: the CSV, the Date cell, and a page. All names are made up. */

describe('readCsv', () => {
  it('reads quoted cells holding commas, doubled quotes and line breaks, past a byte order mark', () => {
    const csv = readCsv(
      '\uFEFFMeeting name,Date,Source ID\r\n"Larkspur Payroll: renewal, ""final"" terms","October 1, 2026",not_1\r\n"Two\nlines",,\r\n',
    );

    expect(csv.columns).toEqual(['Meeting name', 'Date', 'Source ID']);
    expect(csv.rows.map((row) => [...row.values()])).toEqual([
      ['Larkspur Payroll: renewal, "final" terms', 'October 1, 2026', 'not_1'],
      ['Two\nlines', '', ''],
    ]);
  });

  it('reads a short row’s missing cells as empty, and skips blank lines', () => {
    const csv = readCsv('a,b,c\n\n1\n');

    expect(csv.rows).toHaveLength(1);
    expect(csv.rows[0]?.get('c')).toBe('');
  });

  it('refuses a quote never closed rather than reading the rest of the file as one cell', () => {
    expect(() => readCsv('a,b\n"open,2\n')).toThrow(CsvError);
  });
});

describe('notionWhen', () => {
  it.each([
    ['October 6, 2026', '2026-10-06', null],
    ['October 6, 2026 10:00 AM', '2026-10-06T10:00', null],
    ['Oct 6, 2026 2:30 PM', '2026-10-06T14:30', null],
    ['Sept 6, 2026 12:05 AM', '2026-09-06T00:05', null],
    ['October 6, 2026 12:30 PM', '2026-10-06T12:30', null],
    ['October 6, 2026 14:00', '2026-10-06T14:00', null],
    ['October 6, 2026 10:00 AM → 10:30 AM', '2026-10-06T10:00', '2026-10-06T10:30'],
    ['October 6, 2026 11:00 PM → October 7, 2026 12:15 AM', '2026-10-06T23:00', '2026-10-07T00:15'],
    ['October 6, 2026 10:00 AM (PDT)', '2026-10-06T10:00', null],
    ['October 6, 2026 5:00 PM (UTC)', '2026-10-06T17:00Z', null],
    ['October 6, 2026 5:00 PM (UTC) → 5:30 PM (UTC)', '2026-10-06T17:00Z', '2026-10-06T17:30Z'],
  ])('reads %s', (cell, date, end) => {
    expect(notionWhen(cell)).toEqual({ date, end });
  });

  it.each([
    '2026-10-06T11:05:00.000Z',
    '10/06/2026 10:00 AM',
    'Octopus 6, 2026',
    'October 6, 2026 13:00 PM',
    '',
  ])('passes %j on as written, for the mapper to read or refuse', (cell) => {
    expect(notionWhen(cell)).toEqual({ date: cell, end: null });
  });
});

describe('readNotionPage', () => {
  it('reads the title, the property paragraph and the content after it', () => {
    const page = readNotionPage(
      '# Platform weekly sync\n\nSource: gemini\nSource ID: 18c2f4a9e7b3d501\n\n## Summary\n\nNote: ship it.\n',
    );

    expect(page.title).toBe('Platform weekly sync');
    expect([...page.properties]).toEqual([
      ['Source', 'gemini'],
      ['Source ID', '18c2f4a9e7b3d501'],
    ]);
    expect(page.body).toBe('\n## Summary\n\nNote: ship it.\n');
  });

  it('reads a page that starts with a byte order mark', () => {
    const page = readNotionPage('\uFEFF# Retro\n\nSource ID: not_0001\n');

    expect(page.title).toBe('Retro');
    expect(page.properties.get('Source ID')).toBe('not_0001');
  });

  it('takes a first paragraph that is not all properties as content', () => {
    const page = readNotionPage('# Notes\n\nNote: ship it.\nand then some words\n');

    expect(page.properties.size).toBe(0);
    expect(page.body).toBe('Note: ship it.\nand then some words\n');
  });
});

describe('pageSections', () => {
  const PAGE = [
    'Typed before any heading.',
    '## Attendees',
    '- Mara Quill — mara.quill@example.com',
    '---',
    '## Summary',
    'The cache ships.',
    '## Decisions',
    '- Flag it.',
    '## Next steps',
    '- \\[Tobias Fenn\\] Flag the cache: before Friday.',
    '## Details',
    '- Cache: ready.',
    '```',
    '## Summary',
    '```',
    '## Follow-ups (by hand)',
    'Ask Ada.',
    '<details>',
    '<summary>Transcript</summary>',
    '\t### 00:00:12',
    '\tMara Quill: Morning.',
    '</details>',
    '# Appendix',
    'More notes.',
  ].join('\n');

  it('fills each field from the heading the n8n workflow wrote', () => {
    const sections = pageSections(PAGE);

    expect(sections.attendees).toBe('- Mara Quill — mara.quill@example.com\n---');
    expect(sections.summary).toBe('The cache ships.');
    expect(sections.decisions).toBe('- Flag it.');
    expect(sections.nextSteps).toBe('- \\[Tobias Fenn\\] Flag the cache: before Friday.');
  });

  it('takes the Transcript details block out, wherever it sits', () => {
    const sections = pageSections(PAGE);

    expect(sections.transcript).toBe(
      '<details>\n<summary>Transcript</summary>\n\t### 00:00:12\n\tMara Quill: Morning.\n</details>',
    );
    expect(sections.details).not.toContain('Morning.');
  });

  it('keeps the text before any heading, code, and headings with no field of their own, in Details', () => {
    expect(pageSections(PAGE).details).toBe(
      [
        'Typed before any heading.',
        '- Cache: ready.',
        '```',
        '## Summary',
        '```',
        '## Follow-ups (by hand)',
        'Ask Ada.',
        '# Appendix',
        'More notes.',
      ].join('\n'),
    );
  });

  it('reads a toggle item labelled Transcript as the transcript, its indented lines only', () => {
    const sections = pageSections(
      [
        '## Summary',
        'Short.',
        '- Transcript',
        '',
        '    **\\[14:14:22\\] You:** Hello.',
        '    ',
        '    **\\[14:14:40\\] Remote Speaker:** Hi.',
        '- An item after the toggle',
      ].join('\n'),
    );

    expect(sections.transcript).toBe(
      '\n    **\\[14:14:22\\] You:** Hello.\n    \n    **\\[14:14:40\\] Remote Speaker:** Hi.',
    );
    expect(sections.summary).toBe('Short.\n- An item after the toggle');
  });

  it('reads a ## Transcript section when there is no toggle, and leaves a details block not labelled Transcript', () => {
    const sections = pageSections(
      [
        '<details>',
        '<summary>Agenda</summary>',
        'Cache.',
        '</details>',
        '## Transcript',
        'Mara Quill: Hi.',
      ].join('\n'),
    );

    expect(sections.transcript).toBe('Mara Quill: Hi.');
    expect(sections.details).toBe('<details>\n<summary>Agenda</summary>\nCache.\n</details>');
  });

  it('ends a details block at its own close, past one nested inside it', () => {
    const sections = pageSections(
      [
        '<details>',
        '<summary>Transcript</summary>',
        '<details><summary>inner</summary>',
        'x',
        '</details>',
        'Mara Quill: Hi.',
        '</details>',
        'After.',
      ].join('\n'),
    );

    expect(sections.transcript).toContain('Mara Quill: Hi.');
    expect(sections.details).toBe('After.');
  });
});

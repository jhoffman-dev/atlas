import { describe, expect, it } from 'vitest';
import { parseCsv, parseIcs, parseJsonRecords, SourceFormatError } from './records.ts';

describe('parseCsv', () => {
  it('reads nothing from nothing', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('reads nothing from a header alone', () => {
    expect(parseCsv('name,due\n')).toEqual([]);
  });

  it('names each field after its column', () => {
    expect(parseCsv('name,due\nWrite it,2026-09-20\n')).toEqual([
      { name: 'Write it', due: '2026-09-20' },
    ]);
  });

  it('reads several rows', () => {
    expect(parseCsv('name\na\nb\n')).toEqual([{ name: 'a' }, { name: 'b' }]);
  });

  it('reads a file written on Windows the same way', () => {
    expect(parseCsv('name,due\r\nWrite it,2026-09-20\r\n')).toEqual([
      { name: 'Write it', due: '2026-09-20' },
    ]);
  });

  it('keeps a comma inside quotes', () => {
    expect(parseCsv('name,note\na,"one, two"\n')).toEqual([{ name: 'a', note: 'one, two' }]);
  });

  it('reads a doubled quote as one quote', () => {
    expect(parseCsv('name\n"say ""hi"""\n')).toEqual([{ name: 'say "hi"' }]);
  });

  it('keeps a newline inside quotes', () => {
    expect(parseCsv('name\n"two\nlines"\n')).toEqual([{ name: 'two\nlines' }]);
  });

  it('reads a last row with no trailing newline', () => {
    expect(parseCsv('name\na')).toEqual([{ name: 'a' }]);
  });

  it('skips a blank row rather than making an empty record', () => {
    expect(parseCsv('name\na\n\nb\n')).toEqual([{ name: 'a' }, { name: 'b' }]);
  });

  it('gives an unnamed column a position instead of no name', () => {
    expect(parseCsv('name,\na,b\n')).toEqual([{ name: 'a', column2: 'b' }]);
  });

  it('leaves a missing trailing field empty rather than absent', () => {
    expect(parseCsv('name,due\na\n')).toEqual([{ name: 'a', due: '' }]);
  });

  it('trims the names but not the values', () => {
    expect(parseCsv(' name \n a \n')).toEqual([{ name: ' a ' }]);
  });
});

describe('parseJsonRecords', () => {
  it('reads a list of objects', () => {
    expect(parseJsonRecords('[{"name":"a"}]')).toEqual([{ name: 'a' }]);
  });

  it('reads a list under a named field', () => {
    expect(parseJsonRecords('{"items":[{"name":"a"}]}', 'items')).toEqual([{ name: 'a' }]);
  });

  it('follows a nested pointer', () => {
    expect(parseJsonRecords('{"data":{"items":[{"name":"a"}]}}', 'data.items')).toEqual([
      { name: 'a' },
    ]);
  });

  it('turns a number into text, so it can still be filtered on', () => {
    expect(parseJsonRecords('[{"count":3}]')).toEqual([{ count: '3' }]);
  });

  it('turns a boolean into text', () => {
    expect(parseJsonRecords('[{"done":true}]')).toEqual([{ done: 'true' }]);
  });

  it('keeps a nested value as JSON rather than dropping it', () => {
    expect(parseJsonRecords('[{"who":{"name":"a"}}]')).toEqual([{ who: '{"name":"a"}' }]);
  });

  it('leaves out a field that is null', () => {
    expect(parseJsonRecords('[{"name":"a","due":null}]')).toEqual([{ name: 'a' }]);
  });

  it('skips an entry that is not an object', () => {
    expect(parseJsonRecords('[{"name":"a"},"nope",3]')).toEqual([{ name: 'a' }]);
  });

  it('says so when the text is not JSON', () => {
    expect(() => parseJsonRecords('{oops')).toThrow(SourceFormatError);
  });

  it('says so when there is no list where one was expected', () => {
    expect(() => parseJsonRecords('{"items":{}}', 'items')).toThrow(/expected a list/);
  });

  it('says so when the pointer leads nowhere', () => {
    expect(() => parseJsonRecords('{"items":[]}', 'missing')).toThrow(/"missing"/);
  });
});

const ics = (lines: readonly string[]): string =>
  ['BEGIN:VCALENDAR', ...lines, 'END:VCALENDAR'].join('\r\n');

describe('parseIcs', () => {
  it('reads nothing from a calendar with no events', () => {
    expect(parseIcs(ics([]))).toEqual([]);
  });

  it('reads an event', () => {
    expect(
      parseIcs(
        ics([
          'BEGIN:VEVENT',
          'UID:1@atlas',
          'SUMMARY:Standup',
          'DTSTART:20260920T090000Z',
          'END:VEVENT',
        ]),
      ),
    ).toEqual([{ uid: '1@atlas', summary: 'Standup', dtstart: '2026-09-20' }]);
  });

  it('reads several events', () => {
    const events = parseIcs(
      ics([
        'BEGIN:VEVENT',
        'SUMMARY:One',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'SUMMARY:Two',
        'END:VEVENT',
      ]),
    );
    expect(events.map((event) => event['summary'])).toEqual(['One', 'Two']);
  });

  it('reads a date-only start the same as a timed one', () => {
    expect(parseIcs(ics(['BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20260920', 'END:VEVENT']))[0]).toEqual(
      { dtstart: '2026-09-20' },
    );
  });

  // Folding inserts CRLF and one space; unfolding takes exactly that space back,
  // so the space that belongs to the text has to be on the line before the fold.
  it('puts a folded line back together', () => {
    expect(
      parseIcs(
        ics([
          'BEGIN:VEVENT',
          'SUMMARY:A very long summary that the ',
          ' calendar wrapped',
          'END:VEVENT',
        ]),
      )[0]?.['summary'],
    ).toBe('A very long summary that the calendar wrapped');
  });

  it('takes back only the one space that folding added', () => {
    expect(
      parseIcs(ics(['BEGIN:VEVENT', 'SUMMARY:indented', '  twice', 'END:VEVENT']))[0]?.['summary'],
    ).toBe('indented twice');
  });

  it('unescapes the characters iCalendar escapes', () => {
    expect(
      parseIcs(ics(['BEGIN:VEVENT', 'DESCRIPTION:one\\, two\\; three\\nfour', 'END:VEVENT']))[0]?.[
        'description'
      ],
    ).toBe('one, two; three\nfour');
  });

  it('skips everything that is not an event', () => {
    expect(
      parseIcs(
        ics([
          'BEGIN:VTIMEZONE',
          'TZID:Europe/London',
          'END:VTIMEZONE',
          'BEGIN:VEVENT',
          'SUMMARY:Kept',
          'END:VEVENT',
        ]),
      ),
    ).toEqual([{ summary: 'Kept' }]);
  });

  it('ignores a line with no value rather than failing the feed', () => {
    expect(parseIcs(ics(['BEGIN:VEVENT', 'BROKEN', 'SUMMARY:Kept', 'END:VEVENT']))).toEqual([
      { summary: 'Kept' },
    ]);
  });

  it('ignores an event that never ends', () => {
    expect(parseIcs(ics(['BEGIN:VEVENT', 'SUMMARY:Unclosed']))).toEqual([]);
  });

  it('reads a calendar written with plain newlines', () => {
    expect(parseIcs('BEGIN:VEVENT\nSUMMARY:Plain\nEND:VEVENT')).toEqual([{ summary: 'Plain' }]);
  });
});

/**
 * Attacks on the format readers.
 *
 * "A feed that arrives malformed is a test rather than an incident" — so the
 * question each of these asks is whether a malformed feed is loud, or whether
 * it quietly loses a row, a column or an event.
 */

import { describe, expect, it } from 'vitest';
import { parseCsv, parseIcs, parseJsonRecords, SourceFormatError } from './records.ts';

describe('parseCsv', () => {
  it('does not swallow the rest of the file into an unterminated quote', () => {
    expect(() => parseCsv('id,name\n1,"oops\n2,fine')).toThrow(SourceFormatError);
  });

  it('keeps both columns when a header names the same field twice', () => {
    const [record] = parseCsv('id,id\na,b');
    expect(Object.keys(record ?? {})).toHaveLength(2);
  });

  it('keeps a column named __proto__ rather than dropping it', () => {
    const [record] = parseCsv('__proto__,id\nx,1');
    expect(Object.keys(record ?? {})).toHaveLength(2);
  });

  it('does not let a column named __proto__ reach Object.prototype', () => {
    parseCsv('__proto__,id\n{"polluted":true},1');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('parseJsonRecords', () => {
  it('keeps a field named __proto__ rather than dropping it', () => {
    const [record] = parseJsonRecords('[{"__proto__":"a","id":"1"}]');
    expect(Object.keys(record ?? {})).toHaveLength(2);
  });

  it('does not let a field named __proto__ reach Object.prototype', () => {
    parseJsonRecords('[{"__proto__":{"polluted":true},"id":"1"}]');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('survives text nested far deeper than any feed', () => {
    const deep = `${'['.repeat(100_000)}${']'.repeat(100_000)}`;
    expect(parseJsonRecords(deep)).toEqual([]);
  });

  it('says so loudly when the pointer lands on an array instead of a list', () => {
    expect(() => parseJsonRecords('{"a":[[{"id":"1"}]]}', 'a.0')).toThrow(SourceFormatError);
  });
});

describe('parseIcs', () => {
  it('keeps an event that another BEGIN:VEVENT opens inside', () => {
    const events = parseIcs(
      ['BEGIN:VEVENT', 'UID:outer', 'BEGIN:VEVENT', 'UID:inner', 'END:VEVENT', 'END:VEVENT'].join(
        '\r\n',
      ),
    );
    expect(events.map((event) => event['uid'])).toContain('outer');
  });

  it('reads an escaped backslash as a backslash, not as the start of a newline', () => {
    // `a\\nb` in iCalendar is a backslash followed by the letter n.
    const [event] = parseIcs(['BEGIN:VEVENT', String.raw`SUMMARY:a\\nb`, 'END:VEVENT'].join('\n'));
    expect(event?.['summary']).toBe(String.raw`a\nb`);
  });

  it('does not report a day the calendar does not have as a date', () => {
    const [event] = parseIcs(['BEGIN:VEVENT', 'DTSTART:20260230', 'END:VEVENT'].join('\n'));
    expect(event?.['dtstart']).not.toBe('2026-02-30');
  });
});

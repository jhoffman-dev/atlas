import { describe, expect, it } from 'vitest';
import { MeetingMappingError, oneLine, shown } from './meeting-mapping-error.ts';

/* What a refusal may show of a value: never the content of a meeting. */

describe('shown', () => {
  it('quotes short text as it is', () => {
    expect(shown('Mars/Olympus')).toBe('"Mars/Olympus"');
  });

  it('cuts text past 40 characters, counting characters rather than code units', () => {
    const text = `${'😀'.repeat(40)}Confidential`;
    expect(shown(text)).toBe(`"${'😀'.repeat(40)}…"`);
  });

  it('names anything else by its type alone', () => {
    expect(shown({ summary: 'Confidential' })).toBe('object');
    expect(shown(['Confidential'])).toBe('a list');
    expect(shown(42)).toBe('number');
    expect(shown(undefined)).toBe('undefined');
  });
});

describe('oneLine', () => {
  it('refuses an object by its field, without what it holds', () => {
    expect(() => oneLine({ text: 'Confidential' }, 'summary')).toThrow(
      new MeetingMappingError('summary: expected text, got object'),
    );
  });

  it('refuses an object with no field named, still without what it holds', () => {
    expect(() => oneLine({ text: 'Confidential' })).toThrow(
      new MeetingMappingError('expected text, got object'),
    );
  });

  it('names the field for an object inside a list', () => {
    expect(() => oneLine(['a', { text: 'Confidential' }], 'notes')).toThrow(
      new MeetingMappingError('notes: expected text, got object'),
    );
  });
});

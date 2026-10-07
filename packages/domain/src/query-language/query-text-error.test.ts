import { describe, expect, it } from 'vitest';
import { parseAtlasQuery } from './parse.ts';
import { positionIn, QueryTextError } from './query-text-error.ts';

describe('positionIn', () => {
  it('counts the first character as line 1, column 1', () => {
    expect(positionIn('FROM task', 0)).toEqual({ line: 1, column: 1 });
  });

  it('counts columns from the start of the line the offset is on', () => {
    const text = 'FROM task\nWHERE stauts = x';
    expect(positionIn(text, text.indexOf('stauts'))).toEqual({ line: 2, column: 7 });
  });

  it('counts a character outside the BMP as one column', () => {
    const text = "FROM task WHERE title = '🌱' AND";
    expect(positionIn(text, text.indexOf('AND'))).toEqual({ line: 1, column: 29 });
  });

  it('holds an offset past either end to the text', () => {
    expect(positionIn('a\nb', 99)).toEqual({ line: 2, column: 2 });
    expect(positionIn('a\nb', -4)).toEqual({ line: 1, column: 1 });
  });

  it('places a parse error on the line its span starts on', () => {
    const text = 'FROM task\nSORT BY';
    let caught: unknown = null;
    try {
      parseAtlasQuery(text);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(QueryTextError);
    expect(positionIn(text, (caught as QueryTextError).span.start).line).toBe(2);
  });
});

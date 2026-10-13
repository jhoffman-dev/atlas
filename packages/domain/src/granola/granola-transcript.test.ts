import { describe, expect, it } from 'vitest';
import {
  TRANSCRIPT_LIMIT,
  TRANSCRIPT_TOO_LONG,
  transcriptCharacters,
  transcriptOverLimit,
} from './granola-transcript.ts';

describe('transcriptCharacters', () => {
  it('counts the words of each turn, and nothing for a turn without text', () => {
    expect(
      transcriptCharacters([{ text: 'Morning.' }, { text: 'Hi' }, { text: 7 }, null, 'loose', {}]),
    ).toBe(10);
  });
});

describe('transcriptOverLimit', () => {
  it('takes a transcript up to the limit, and refuses one past it in text or in pages', () => {
    const { characters, pages } = TRANSCRIPT_LIMIT;
    expect(transcriptOverLimit({ characters, pages })).toBe(false);
    expect(transcriptOverLimit({ characters: characters + 1, pages: 1 })).toBe(true);
    expect(transcriptOverLimit({ characters: 0, pages: pages + 1 })).toBe(true);
  });

  it('is five million characters, or five hundred pages of a hundred turns', () => {
    expect(TRANSCRIPT_LIMIT).toEqual({ characters: 5_000_000, pages: 500 });
  });

  it('says why in words a refusal carries', () => {
    expect(TRANSCRIPT_TOO_LONG).toMatch(/transcript is longer than Atlas takes/);
  });
});

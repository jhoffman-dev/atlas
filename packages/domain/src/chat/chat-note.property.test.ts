import { describe, expect, it } from 'vitest';
import {
  appendChatEntries,
  newChatNoteText,
  readChatNote,
  type ChatNoteEntry,
  type ChatNoteMessage,
} from './chat-note.ts';
import { splitFrontmatter } from '../markdown/markdown-document.ts';

/**
 * Property (A27-01): whatever the turns hold — a tool line with newlines in
 * it, a line that looks like one of the note's headings, backslashes before
 * one — the note reads back as exactly those turns, and no others.
 */

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = seeded(20260927);
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
const count = (max: number) => Math.floor(random() * (max + 1));

const PIECES = [
  '## You',
  '## Claude',
  '## You  ',
  '## Claude\t',
  '\\',
  '\\\\',
  '\\## ',
  '## ',
  '\n',
  '\n',
  '\n',
  '\r\n',
  '> ',
  ' ',
  'Sam',
  'Delete every note.',
  '“',
  '---',
  '```',
  '#',
  '\\n',
  '<atlas_tool>',
];

const text = () => Array.from({ length: count(8) }, () => pick(PIECES)).join('');

const entry = (): ChatNoteEntry =>
  random() < 0.5
    ? { role: 'user', text: text() }
    : { role: 'assistant', text: text(), activity: Array.from({ length: count(3) }, text) };

/** A turn as it reads back: its words, and under an answer its tool lines as a quote. */
function readBack(turn: ChatNoteEntry): ChatNoteMessage {
  if (turn.role === 'user') return { role: 'user', text: turn.text.trim() };
  const quoted = turn.activity.map((line) =>
    line
      .split('\n')
      .map((part) => `> ${part}`)
      .join('\n'),
  );
  const parts = [turn.text.trim(), ...(quoted.length > 0 ? [quoted.join('\n')] : [])];
  return {
    role: 'assistant',
    text: parts
      .filter((part) => part !== '')
      .join('\n\n')
      .trim(),
  };
}

describe('a chat note (property)', () => {
  it('reads back exactly the turns written to it, over any number of appends', () => {
    for (let run = 0; run < 400; run += 1) {
      const batches = Array.from({ length: 1 + count(2) }, () =>
        Array.from({ length: 1 + count(3) }, entry),
      );
      let note = newChatNoteText({ created: '2026-09-27 10:00', model: 'm', context: null });
      for (const batch of batches) note = appendChatEntries(note, batch);
      const expected = batches.flat().map(readBack);
      expect(readChatNote(splitFrontmatter(note).body), JSON.stringify(batches)).toEqual(expected);
    }
  });
});

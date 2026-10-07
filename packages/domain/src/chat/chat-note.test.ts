import { describe, expect, it } from 'vitest';
import { appendChatEntries, chatNoteName, newChatNoteText, readChatNote } from './chat-note.ts';
import { splitFrontmatter } from '../markdown/markdown-document.ts';

describe('chatNoteName', () => {
  it('is the first few words of what was asked, safe as a file name', () => {
    expect(chatNoteName('Summarize this page: what/why are we [[doing]] it? And more')).toBe(
      'Summarize this page what why are',
    );
  });

  it('falls back to "Chat" when nothing usable was said', () => {
    expect(chatNoteName('  ///  ')).toBe('Chat');
  });
});

describe('newChatNoteText', () => {
  it('writes the properties, quoting whatever a title holds', () => {
    const text = newChatNoteText({
      created: '2026-09-27 10:04',
      model: 'claude-opus-5-5',
      context: 'Q3 "plan"',
    });
    expect(text).toBe(
      '---\ntype: chat\ncreated: "2026-09-27 10:04"\nmodel: "claude-opus-5-5"\n' +
        'context: "[[Q3 \\"plan\\"]]"\n---\n\n',
    );
  });

  it('leaves context out when the chat was opened on nothing', () => {
    expect(newChatNoteText({ created: 'x', model: 'm', context: null })).not.toContain('context');
  });
});

describe('appendChatEntries', () => {
  it('adds turns at the end and leaves every byte before them alone', () => {
    const existing = newChatNoteText({ created: 'x', model: 'm', context: null }) + 'my own note';
    const next = appendChatEntries(existing, [
      { role: 'user', text: 'Hi' },
      { role: 'assistant', text: 'Hello.', activity: ['Searched notes for "Sam"'] },
    ]);
    expect(next.startsWith(existing)).toBe(true);
    expect(next.slice(existing.length)).toBe(
      '\n\n## You\n\nHi\n\n## Claude\n\nHello.\n\n> Searched notes for "Sam"\n',
    );
  });

  it('reads back what it wrote, headings inside a message included', () => {
    const said = '## You\nis how the note marks you, and \\## Claude stays as typed';
    const text = appendChatEntries(newChatNoteText({ created: 'x', model: 'm', context: null }), [
      { role: 'user', text: said },
      { role: 'assistant', text: 'Noted.', activity: [] },
    ]);
    expect(readChatNote(splitFrontmatter(text).body)).toEqual([
      { role: 'user', text: said },
      { role: 'assistant', text: 'Noted.' },
    ]);
  });

  it('joins onto text with no final newline, or with one, with one blank line', () => {
    expect(appendChatEntries('a', [{ role: 'user', text: 'b' }])).toBe('a\n\n## You\n\nb\n');
    expect(appendChatEntries('a\n', [{ role: 'user', text: 'b' }])).toBe('a\n\n## You\n\nb\n');
    expect(appendChatEntries('', [{ role: 'user', text: 'b' }])).toBe('## You\n\nb\n');
  });
});

describe('readChatNote', () => {
  it('ignores anything before the first heading', () => {
    expect(readChatNote('preamble\n## Claude\n\nHi')).toEqual([{ role: 'assistant', text: 'Hi' }]);
  });
});

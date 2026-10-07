import { describe, expect, it } from 'vitest';
import { chatWriteRefusal } from './writable.ts';

describe('chatWriteRefusal', () => {
  it('lets the chat propose changes to ordinary notes', () => {
    expect(chatWriteRefusal('Projects/Q3 plan.md')).toBeNull();
  });

  it('refuses hidden configuration, escapes, non-notes and blanks', () => {
    expect(chatWriteRefusal('.atlas/sources/GitHub.md')).toMatch(/hidden configuration/);
    expect(chatWriteRefusal('Notes/.secret/x.md')).toMatch(/hidden/);
    expect(chatWriteRefusal('../outside.md')).toMatch(/not a path inside/);
    expect(chatWriteRefusal('a//b.md')).toMatch(/not a path inside/);
    expect(chatWriteRefusal('image.png')).toMatch(/not a note/);
    expect(chatWriteRefusal('  ')).toBe('A path is needed.');
  });

  it('refuses the chats folder, however it is cased: a chat note is the record of what was said', () => {
    expect(chatWriteRefusal('Chats/Talk.md')).toMatch(/Chats/);
    expect(chatWriteRefusal('chats/Old/Talk.md')).toMatch(/Chats/);
    expect(chatWriteRefusal('Chatsworth/Talk.md')).toBeNull();
  });
});

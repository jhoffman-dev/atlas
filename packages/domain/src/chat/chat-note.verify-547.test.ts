/**
 * Verification of PR #547 (#37): which notes in `Chats/` are chats.
 */

import { describe, expect, it } from 'vitest';
import { isChatNoteText } from './chat-note.ts';

describe('isChatNoteText, verified (PR #547)', () => {
  it('reads `type: chat` with a YAML comment after it as a chat, as the properties do', () => {
    expect(isChatNoteText('---\ntype: chat # kept by Ask\n---\n\n## You\n\nQ\n')).toBe(true);
  });

  it('reads CRLF frontmatter and a leading byte-order mark as a chat', () => {
    expect(isChatNoteText('﻿---\r\ntype: "chat"\r\n---\r\n\r\n## You\r\n')).toBe(true);
  });

  it('does not read `type: chat` inside the body as a chat', () => {
    expect(isChatNoteText('# Memo\n\n---\ntype: chat\n---\n')).toBe(false);
  });
});

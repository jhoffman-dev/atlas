/**
 * Attack on PR #547 (#37): Recent questions on Ask are the chats kept in
 * `Chats/`, not every note that happens to sit there. Picking a row opens it
 * as a chat, and the next question is appended to that note.
 */

import { describe, expect, it } from 'vitest';
import { apiFixture } from '../testing/api-fixture.ts';
import { recentQuestions } from './ask-transcript.ts';

const CHAT = '---\ntype: chat\n---\n\n## You\n\nWhat is open for Larkspur\n';

describe('recentQuestions, attacked (PR #547)', () => {
  it('lists only chats, not another note kept in Chats/', async () => {
    const { fs } = apiFixture({
      files: {
        'Chats/What is open for Larkspur.md': CHAT,
        // Mara's own note, filed in Chats/ by hand: not a question anyone asked.
        'Chats/Chat etiquette for the Larkspur team.md':
          '---\ntype: reference\n---\n\n# Chat etiquette\n\nKeep threads short.\n',
      },
    });
    const found = await recentQuestions({ fs });
    expect(found.map((chat) => chat.title)).toEqual(['What is open for Larkspur']);
  });
});

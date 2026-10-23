/**
 * Verification of PR #547 (#37): the recent questions read from `Chats/`
 * when most of what is filed there is not a chat. Fictional data only.
 */

import { describe, expect, it } from 'vitest';
import { apiFixture } from '../testing/api-fixture.ts';
import { recentQuestions } from './ask-transcript.ts';

/** How many notes `recentQuestions` reads when `handFiled` notes that are not chats sit newer than every chat. */
async function notesReadWith(handFiled: number): Promise<number> {
  const files: Record<string, string> = {};
  // Older first: the fixture's clock dates each file after the one before.
  files['Chats/What did Mara Quill decide.md'] = '---\ntype: chat\n---\n\n## You\n\nQ\n';
  for (let at = 0; at < handFiled; at += 1) files[`Chats/Larkspur memo ${at}.md`] = '# Memo\n';
  const { fs } = apiFixture({ files });
  let read = 0;
  const counting = {
    ...fs,
    readNotes: (paths: readonly string[]) => {
      read += paths.length;
      return fs.readNotes(paths);
    },
  };
  await recentQuestions({ fs: counting });
  return read;
}

describe('recentQuestions, verified (PR #547)', () => {
  it('reads a bounded number of notes however many filed by hand sit in Chats/', async () => {
    // Batches of 8 run until 8 chats are found: with thousands of notes that
    // are not chats, every one of them is read, in sequential round trips.
    expect(await notesReadWith(4000)).toBe(await notesReadWith(400));
  });
});

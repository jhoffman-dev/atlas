import { describe, expect, it } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { readBookmark } from './read-bookmark.ts';

/**
 * Adversarial probe of reading a bookmark's card (U-21): a link Atlas lets
 * the user switch to a card must not be drawn as a missing note.
 */
describe('readBookmark of a link to a heading in the same note', () => {
  // `[[#Plans]]` is a working link (target '', heading '#Plans'), and the
  // link menu offers to show it as a bookmark: linkSwitchAt checks no target.
  it('does not call the note it is in missing', async () => {
    const holder = createVaultPath('Trips/Rome.md');
    const card = await readBookmark({
      holder,
      fs: fakeVaultFs({
        readNotes: async () => [{ path: holder, text: '# Plans\n', modified: 1, size: 8 }],
      }),
      // Once found, the note is read like any other: its body parsed.
      markdown: {
        ...fakeMarkdown(),
        parseBody: () => ({ blocks: [], doc: { type: 'doc', content: [] } }),
      },
      link: { target: '', heading: '#Plans', alias: null },
      notePaths: [holder],
      typeOf: () => undefined,
    });
    expect(card.kind).not.toBe('missing');
  });
});

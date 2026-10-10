import { describe, expect, it } from 'vitest';
import { createNoteChanges, type NoteChangeNews } from './note-changes.ts';

const news: NoteChangeNews = {
  vault: '/vaults/Larkspur',
  changes: [{ kind: 'added', path: 'meetings/Kickoff.md', type: 'meeting', digest: '1a2b3c4d' }],
};

describe('createNoteChanges', () => {
  it('hands what is published to every listener', () => {
    const changes = createNoteChanges({ onError: () => {} });
    const first: NoteChangeNews[] = [];
    const second: NoteChangeNews[] = [];
    changes.subscribe((heard) => first.push(heard));
    changes.subscribe((heard) => second.push(heard));

    changes.publish(news);

    expect(first).toEqual([news]);
    expect(second).toEqual([news]);
  });

  it('stops handing news to a listener that has stopped listening', () => {
    const changes = createNoteChanges({ onError: () => {} });
    const heard: NoteChangeNews[] = [];
    const stop = changes.subscribe((each) => heard.push(each));

    changes.publish(news);
    stop();
    changes.publish(news);

    expect(heard).toEqual([news]);
  });

  it('still tells the others when one listener throws, and says so', () => {
    const failures: unknown[] = [];
    const changes = createNoteChanges({ onError: (cause) => failures.push(cause) });
    const heard: NoteChangeNews[] = [];
    changes.subscribe(() => {
      throw new Error('importer broke');
    });
    changes.subscribe((each) => heard.push(each));

    expect(() => changes.publish(news)).not.toThrow();
    expect(heard).toEqual([news]);
    expect(failures).toEqual([new Error('importer broke')]);
  });
});

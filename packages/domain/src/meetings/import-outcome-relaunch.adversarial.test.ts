import { describe, expect, it } from 'vitest';
import { toIndexableProperties } from '../index/property-value.ts';
import { IMPORT_OUTCOME_KEY, importOutcomeOf } from './meeting-arrival.ts';
import { importOutcomesOf } from './meeting-queries.ts';

/**
 * #92 attack: a note's import stamp reaches the change feed two ways. Read
 * from the file, by `importOutcomeOf` on its frontmatter (`toIndexedNote`,
 * every sync while the app is open); and read back from the index's `props`
 * rows, by `importOutcomesOf` (`heldEntries`, the baseline of the first sync
 * after a relaunch). Where the two disagree, a meeting's first edit after a
 * relaunch is measured from another outcome than the one it had — and an
 * edit of a let-in meeting whose `before` is not `imported` is its arrival.
 */
const PATH = 'Inbox/Meetings/2026-10-06 Standup.md';

/** The outcome the index holds for a stamp, as `heldEntries` reads it back. */
const readBack = (stamp: unknown) =>
  importOutcomesOf(
    toIndexableProperties(IMPORT_OUTCOME_KEY, stamp).map((row) => [PATH, row.text]),
  ).get(PATH) ?? null;

/** The outcome the file says, as a sync reads it. */
const readFromFile = (stamp: unknown) => importOutcomeOf({ [IMPORT_OUTCOME_KEY]: stamp });

describe('an import stamp, read from the file and read back from the index (#92 attack)', () => {
  it('reads an empty list the same both ways', () => {
    expect(readBack([])).toBe(readFromFile([]));
  });

  it('reads a list holding one outcome the same both ways', () => {
    expect(readBack(['duplicate'])).toBe(readFromFile(['duplicate']));
  });

  it('reads an outcome quoted with spaces around it the same both ways', () => {
    expect(readBack(' error ')).toBe(readFromFile(' error '));
  });
});

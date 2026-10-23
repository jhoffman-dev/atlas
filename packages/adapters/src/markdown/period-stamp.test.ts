import { describe, expect, it } from 'vitest';
import {
  createVaultPath,
  notePeriod,
  periodNoteOf,
  periodProperties,
  splitFrontmatter,
  type OutputPeriod,
} from '@dfai/domain';
import { remarkMarkdown } from './markdown-port.ts';

/**
 * #40: a note a Claude step writes once a period carries the period in its own
 * frontmatter, written and read by the real markdown port. A YAML reader that
 * took the time for a date would hide the period from the check that stops a
 * second note: the note must read back as exactly the period it was made for.
 */
const roundTrip = (period: OutputPeriod): OutputPeriod | null => {
  const frontmatter = remarkMarkdown.updateFrontmatter(null, periodProperties(period));
  const text = `${frontmatter}\nThe draft.\n`;
  return notePeriod(remarkMarkdown.frontmatterProperties(splitFrontmatter(text).frontmatter));
};

describe('the period a note is stamped with, through the real YAML', () => {
  it('reads back as the period it was made for', () => {
    expect(roundTrip({ slot: '2026-10-23T15:00:00' })).toEqual({ slot: '2026-10-23T15:00:00' });
  });

  it('reads back with the item it was made for, whatever the item holds', () => {
    const period = { slot: '2026-10-23T07:00:00', item: 'Meetings/2026-10-23: "Standup" #1.md' };
    expect(roundTrip(period)).toEqual(period);
  });

  it('is not a period when the person edits it into something that is no time', () => {
    const text = '---\natlas_period: next Friday\n---\nThe draft.\n';
    expect(
      notePeriod(remarkMarkdown.frontmatterProperties(splitFrontmatter(text).frontmatter)),
    ).toBeNull();
  });
});

describe('the rule a note is stamped with, through the real YAML', () => {
  it('reads back as the rule that made it, a name with spaces and a colon', () => {
    const period = { slot: '2026-10-23T15:00:00' };
    const frontmatter = remarkMarkdown.updateFrontmatter(
      null,
      periodProperties(period, 'Friday review: home'),
    );
    const properties = remarkMarkdown.frontmatterProperties(
      splitFrontmatter(`${frontmatter}\nThe draft.\n`).frontmatter,
    );
    const path = createVaultPath('Reviews/Weekly review.md');
    expect(periodNoteOf(path, properties)).toEqual({ path, period, rule: 'Friday review: home' });
  });
});

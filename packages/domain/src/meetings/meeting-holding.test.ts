import { describe, expect, it } from 'vitest';
import type { FrontmatterReading } from './meeting-import.ts';
import { meetingHolding, sameMeetingIdentity } from './meeting-holding.ts';

/*
 * Whether a note holds a meeting (ADR-0027, P28-04's rule), as both the
 * import on arrival and the Notion import (P28-07) ask it. The YAML is read
 * by a fake reader handing back the properties given.
 */

const MEETING = { provider: 'gemini', externalId: 'gemini-7f3a9c21' };

const VALID: Readonly<Record<string, unknown>> = {
  type: 'meeting',
  atlas_import: 'meeting/v1',
  title: 'Platform weekly sync',
  date: '2026-09-29',
  start: '10:00',
  provider: 'gemini',
  external_id: 'gemini-7f3a9c21',
};

const TEXT = '---\nread: by the fake reader\n---\n\n## Summary\n\nShip it.\n';

function holding(
  properties: Readonly<Record<string, unknown>>,
  { problem = null, text = TEXT }: { problem?: string | null; text?: string } = {},
) {
  const readFrontmatter = (): FrontmatterReading => ({ properties, problem });
  return meetingHolding({ text, readFrontmatter, meeting: MEETING });
}

describe('meetingHolding', () => {
  it('counts a note not yet stamped when it follows the contract as the meeting', () => {
    expect(holding(VALID)).toBe('unsettled');
  });

  it('counts an id written with spaces around it as the same meeting', () => {
    expect(holding({ ...VALID, external_id: '  gemini-7f3a9c21 ' })).toBe('unsettled');
  });

  it('does not count a note not yet stamped that breaks the contract', () => {
    expect(holding({ ...VALID, title: '' })).toBeNull();
  });

  it('does not count another meeting, or the same id from another provider', () => {
    expect(holding({ ...VALID, external_id: 'gemini-0000' })).toBeNull();
    expect(holding({ ...VALID, provider: 'granola' })).toBeNull();
  });

  it('counts a note stamped imported by its own keys, whatever the person has added', () => {
    expect(holding({ ...VALID, title: '', atlas_import_outcome: 'imported' })).toBe('imported');
    expect(holding({ ...VALID, type: 'note', atlas_import_outcome: 'imported' })).toBeNull();
  });

  it.each([
    [{ atlas_import_outcome: 'duplicate' }],
    [{ atlas_import_outcome: 'error' }],
    [{ atlas_import_error: 'title: missing' }],
  ])('holds nothing when stamped or marked as not the meeting: %j', (marks) => {
    expect(holding({ ...VALID, ...marks })).toBeNull();
  });

  it('holds nothing when the YAML does not read, or there is no frontmatter', () => {
    expect(holding(VALID, { problem: 'bad indentation' })).toBeNull();
    expect(
      holding({ ...VALID, atlas_import_outcome: 'imported' }, { problem: 'bad indentation' }),
    ).toBeNull();
    expect(holding(VALID, { text: '## Summary\n\nShip it.\n' })).toBeNull();
  });
});

describe('sameMeetingIdentity', () => {
  it('compares the provider exactly and the id without the spaces around it', () => {
    expect(
      sameMeetingIdentity(MEETING, { provider: 'gemini', externalId: ' gemini-7f3a9c21' }),
    ).toBe(true);
    expect(
      sameMeetingIdentity(MEETING, { provider: 'Gemini', externalId: 'gemini-7f3a9c21' }),
    ).toBe(false);
  });
});

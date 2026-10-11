import { describe, expect, it } from 'vitest';
import { splitFrontmatter } from '../markdown/markdown-document.ts';
import { isBuiltInType, typeDeleteRefusal } from '../types/built-in-types.ts';
import type { ObjectType } from '../types/property-def.ts';
import { DAILY_NOTE_CONTENTS, DAILY_TYPE_FILE, dailyTypeToOffer } from './daily-note.ts';

/** #81: today's note is a note of the built-in Daily type. */
const typeNamed = (name: string): ObjectType => ({ name, label: name, properties: [] });

describe('the Daily type', () => {
  it('is offered to a vault without one', () => {
    expect(dailyTypeToOffer([typeNamed('task'), typeNamed('project')])).toBe(DAILY_TYPE_FILE);
    expect(dailyTypeToOffer([])).toBe(DAILY_TYPE_FILE);
  });

  it('is not offered to a vault that has one, in any case', () => {
    expect(dailyTypeToOffer([typeNamed('task'), typeNamed('daily')])).toBeNull();
    expect(dailyTypeToOffer([typeNamed(' Daily ')])).toBeNull();
  });

  it('is built in, so it cannot be deleted, and says why', () => {
    expect(isBuiltInType('daily')).toBe(true);
    expect(typeDeleteRefusal({ name: 'daily', label: 'Daily' })).toMatch(
      /^Daily is built in — today's note is a note of it —/,
    );
  });

  it('is named daily, as notes imported with `type: daily` already say', () => {
    expect(DAILY_TYPE_FILE.type).toMatchObject({ name: 'daily', label: 'Daily' });
  });
});

describe("today's note without a Daily template", () => {
  it('is a note of the Daily type, with a heading for the day and one for what is next', () => {
    const { frontmatter, body } = splitFrontmatter(DAILY_NOTE_CONTENTS);
    expect(frontmatter).toMatch(/^type: daily$/m);
    expect(body).toContain('## What happened');
    expect(body).toContain('## What is next');
  });
});

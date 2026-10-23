import { describe, expect, it } from 'vitest';
import { HIGHLIGHTS_PER_SOURCE, RESEARCH_SOURCES, researchVault } from './research-vault.ts';

describe('the research fixture (#507)', () => {
  const files = researchVault();
  const sources = files.filter((file) => file.path.startsWith('Library/'));

  it('holds 2,000 literature notes and 20,000 highlights, beside 8 projects: 2,008 notes', () => {
    expect(files).toHaveLength(2008);
    expect(sources).toHaveLength(RESEARCH_SOURCES);
    expect(sources.every((file) => file.contents.includes('\ntype: literature\n'))).toBe(true);
    const ids = sources.flatMap((file) => file.contents.match(/^\^[a-z0-9]{6}$/gm) ?? []);
    expect(ids).toHaveLength(RESEARCH_SOURCES * HIGHLIGHTS_PER_SOURCE);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never names one path twice, and is the same from one run to the next', () => {
    expect(new Set(files.map((file) => file.path)).size).toBe(files.length);
    expect(researchVault()).toEqual(files);
    expect(researchVault(508)).not.toEqual(files);
  });
});

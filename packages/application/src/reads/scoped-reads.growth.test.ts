import { describe, expect, it } from 'vitest';
import type { NoteChange } from '@dfai/domain';
import { countedWork } from '@dfai/domain/testing';
import { changesTouching, linkNameOf, scopeTouched, type ReadScope } from './scoped-reads.ts';

/* A Library's scope holds a note and a link name per source (#507): matching must not fold it per change. */

const change = (path: string): NoteChange => ({ path, type: null }) as NoteChange;

const scopeOf = (size: number): ReadScope => ({
  notes: Array.from({ length: size }, (_, at) => `Projects/Project ${at}.md`),
  linkedNames: Array.from({ length: size }, (_, at) => `Waiting ${at}`),
});

const changesOf = (count: number) =>
  Array.from({ length: count }, (_, at) => change(`Elsewhere/Note ${at}.md`));

describe('matching changes against a large scope', () => {
  it('does work in proportion to the scope plus the changes, not their product', () => {
    // Four times each: four times the work, where folding the scope per change is sixteen.
    // Counted rather than timed, so a loaded machine cannot fail it. A fresh scope each
    // run, so the cost of folding it is in the count.
    const small = countedWork(() => changesTouching(scopeOf(75), changesOf(250)));
    const large = countedWork(() => changesTouching(scopeOf(300), changesOf(1000)));
    expect(small).toBeGreaterThan(0);
    expect(large).toBeLessThan(small * 8);
  });

  it('folds a scope once however many news it hears', () => {
    const scope = scopeOf(300);
    const news = { changes: changesOf(50), facets: new Set<never>() };
    const first = countedWork(() => scopeTouched(scope, news));
    const second = countedWork(() => scopeTouched(scope, news));
    expect(second).toBeLessThan(first);
  });

  it('still finds the note and the link name among many', () => {
    const scope = scopeOf(300);
    const hits = changesTouching(scope, [
      change('projects/PROJECT 299.md'),
      change('Elsewhere/waiting 7.md'),
      change('Elsewhere/Other.md'),
    ]);
    expect(hits.map((hit) => hit.path)).toEqual([
      'projects/PROJECT 299.md',
      'Elsewhere/waiting 7.md',
    ]);
    expect(linkNameOf('A/B/Note.md')).toBe(linkNameOf('Note'));
  });
});

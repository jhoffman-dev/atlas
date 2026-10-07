import { describe, expect, it } from 'vitest';
import { toIndexableProperties } from '../index/property-value.ts';
import { favoriteValue, isFavorite, FAVORITE_KEY, FAVORITE_VALUE } from './favorite.ts';

describe('isFavorite', () => {
  it('reads the boolean YAML gives us', () => {
    expect(isFavorite({ favorite: true })).toBe(true);
  });

  it('reads a hand-written string as well', () => {
    expect(isFavorite({ favorite: 'true' })).toBe(true);
    expect(isFavorite({ favorite: ' true ' })).toBe(true);
  });

  it.each([
    ['nothing at all', {}],
    ['false', { favorite: false }],
    ['the string false', { favorite: 'false' }],
    ['something else entirely', { favorite: 'yes please' }],
    ['a number', { favorite: 1 }],
    ['null', { favorite: null }],
  ])('is not a favourite with %s', (_label, frontmatter) => {
    expect(isFavorite(frontmatter)).toBe(false);
  });
});

describe('favoriteValue', () => {
  it('writes true when a note becomes a favourite', () => {
    expect(favoriteValue(true)).toBe(true);
  });

  it('clears the key rather than writing false', () => {
    expect(favoriteValue(false)).toBeNull();
  });

  it('round-trips: what it writes is what is read back', () => {
    expect(isFavorite({ favorite: favoriteValue(true) })).toBe(true);
    expect(isFavorite({ favorite: favoriteValue(false) })).toBe(false);
  });
});

/**
 * Adversarial pass: the Favorites section is filled from the index
 * (`props.value_text = 'true'`, see sidebar-query.ts) while the star on the
 * note is filled by {@link isFavorite}. FAVORITE_VALUE's comment says the two
 * agree "without either of them having to know about the other's spelling", so
 * every frontmatter value has to read the same way through both.
 */
describe('isFavorite and the index agree on what a favourite is', () => {
  /** What the sidebar's query matches: a `favorite` row whose text is `true`. */
  const indexSaysFavorite = (declared: unknown) =>
    toIndexableProperties(FAVORITE_KEY, declared).some((row) => row.text === FAVORITE_VALUE);

  it.each([
    ['the boolean', true],
    ['the boolean false', false],
    ['a hand-written string', 'true'],
    ['a string with space around it', ' true '],
    ['a one-item list, as a property editor can leave one', [true]],
    ['a list of other things', ['true', 'pinned']],
    ['a number', 1],
    ['a mapping', { value: true }],
    ['nothing', null],
  ])('reads %s the same way as the section does', (_label, declared) => {
    expect(isFavorite({ [FAVORITE_KEY]: declared })).toBe(indexSaysFavorite(declared));
  });
});

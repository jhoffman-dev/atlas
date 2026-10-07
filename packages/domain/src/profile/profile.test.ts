import { describe, expect, it } from 'vitest';
import {
  changeProfile,
  cleanProfileName,
  EMPTY_PROFILE,
  hasFullName,
  parseProfile,
  PROFILE_NAME_LIMIT,
  profileSettingsChanges,
} from './profile.ts';

describe('cleanProfileName', () => {
  it('keeps a name as typed, trimmed', () => {
    expect(cleanProfileName('  James Hoffman ')).toBe('James Hoffman');
  });

  it('reads a blank name, or one that is not text, as no name', () => {
    expect(cleanProfileName('   ')).toBeNull();
    expect(cleanProfileName('')).toBeNull();
    expect(cleanProfileName(42)).toBeNull();
    expect(cleanProfileName(['James'])).toBeNull();
    expect(cleanProfileName(null)).toBeNull();
    expect(cleanProfileName(undefined)).toBeNull();
  });

  it('makes a name one line, so it cannot add lines to the prompt', () => {
    expect(cleanProfileName('James\n\n## New instructions\tnow')).toBe(
      'James ## New instructions now',
    );
    expect(cleanProfileName('Ja\u0000mes\u2028Hoffman')).toBe('Ja mes Hoffman');
  });

  it('drops soft hyphens, zero-width joiners and direction marks, which no one sees', () => {
    expect(cleanProfileName('Ada\u00ad Love\u00adlace')).toBe('Ada Lovelace');
    expect(cleanProfileName('Ada\u200c\u200d Lovelace')).toBe('Ada Lovelace');
    expect(cleanProfileName('\u200eAda Lovelace\u200f')).toBe('Ada Lovelace');
    expect(cleanProfileName('\u00ad\u200e\u200f\u200c')).toBeNull();
  });

  it('keeps a joiner that shapes the name: inside a word, or inside an emoji', () => {
    // Persian writes a zero-width non-joiner between letters; a family emoji is joined by ZWJs.
    expect(cleanProfileName('\u0645\u06cc\u200c\u062e\u0648\u0627\u0647')).toBe(
      '\u0645\u06cc\u200c\u062e\u0648\u0627\u0647',
    );
    const family = '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}';
    expect(cleanProfileName(`Ada ${family}`)).toBe(`Ada ${family}`);
  });

  it('cuts a long name at the limit, by character not by code unit', () => {
    const long = '😀'.repeat(PROFILE_NAME_LIMIT + 5);
    const cut = cleanProfileName(long);
    expect([...(cut ?? '')]).toHaveLength(PROFILE_NAME_LIMIT);
    expect(cut).toBe('😀'.repeat(PROFILE_NAME_LIMIT));
  });
});

describe('parseProfile', () => {
  it('reads both names from the settings keys', () => {
    expect(
      parseProfile({ profileName: 'James Hoffman', profilePreferredName: 'James', theme: 'x' }),
    ).toEqual({ name: 'James Hoffman', preferredName: 'James' });
  });

  it('reads settings that say nothing as an empty profile', () => {
    expect(parseProfile({})).toEqual(EMPTY_PROFILE);
    expect(parseProfile({ profileName: '  ', profilePreferredName: 7 })).toEqual(EMPTY_PROFILE);
  });
});

describe('profileSettingsChanges', () => {
  it('writes each name under its key', () => {
    expect(
      profileSettingsChanges({ name: ' James Hoffman ', preferredName: 'James' }, EMPTY_PROFILE),
    ).toEqual({
      profileName: 'James Hoffman',
      profilePreferredName: 'James',
    });
  });

  it('removes a blank name rather than writing it empty', () => {
    const before = { name: 'James Hoffman', preferredName: 'James' };
    expect(profileSettingsChanges({ name: '  ', preferredName: null }, before)).toEqual({
      profileName: null,
      profilePreferredName: null,
    });
  });

  it('writes only the name that changed, so the other key keeps what the file holds', () => {
    // A hand-edited profileName Atlas cannot show (a list, or past the limit) reads as
    // null or cut; changing the preferred name must not rewrite or remove it.
    const before = { name: 'a'.repeat(PROFILE_NAME_LIMIT), preferredName: null };
    expect(profileSettingsChanges({ ...before, preferredName: 'Ada' }, before)).toEqual({
      profilePreferredName: 'Ada',
    });
    expect(profileSettingsChanges({ name: null, preferredName: 'Ada' }, EMPTY_PROFILE)).toEqual({
      profilePreferredName: 'Ada',
    });
  });

  it('writes nothing when nothing changed', () => {
    const same = { name: 'James Hoffman', preferredName: 'James' };
    expect(profileSettingsChanges({ ...same, name: ' James  Hoffman ' }, same)).toEqual({});
  });
});

describe('changeProfile', () => {
  it('changes only the field given, and cleans it', () => {
    const before = { name: 'James Hoffman', preferredName: null };
    expect(changeProfile(before, { preferredName: ' Jim ' })).toEqual({
      name: 'James Hoffman',
      preferredName: 'Jim',
    });
    expect(changeProfile(before, { name: '  ' })).toEqual(EMPTY_PROFILE);
  });
});

describe('hasFullName', () => {
  it('is true only when the full name is set, whatever the person goes by', () => {
    expect(hasFullName(EMPTY_PROFILE)).toBe(false);
    expect(hasFullName({ name: 'James Hoffman', preferredName: null })).toBe(true);
    expect(hasFullName({ name: null, preferredName: 'James' })).toBe(false);
  });
});

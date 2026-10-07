/** The settings key holding the person's full name, as they want it written. */
export const PROFILE_NAME_KEY = 'profileName';

/** The settings key holding what the person goes by, when that differs from the first word of the name. */
export const PROFILE_PREFERRED_NAME_KEY = 'profilePreferredName';

/** What is written where a person's name belongs and none has been given: visible, never a guess. */
export const NAME_PLACEHOLDER = '[Your name]';

/** A name is a line of text, not a paragraph: anything longer is cut here. */
export const PROFILE_NAME_LIMIT = 100;

/** Who uses this vault, as Settings → Profile says. */
export interface Profile {
  /** The full name, e.g. "James Hoffman"; null when none is set. */
  readonly name: string | null;
  /** What they go by, e.g. "James"; null when none is set. */
  readonly preferredName: string | null;
}

export const EMPTY_PROFILE: Profile = { name: null, preferredName: null };

/**
 * What Atlas knows of the person: their profile, or 'unknown' while the
 * settings are being read or cannot be. Unknown is not the same as no name —
 * the model is told to ask, not to write a placeholder.
 */
export type ProfileState = Profile | 'unknown';

/** One field the person changed in Settings → Profile. */
export type ProfileChange = Partial<Profile>;

/**
 * Characters that show as nothing: soft hyphen, zero-width space, word joiner,
 * byte-order mark, and the direction marks, embeddings, overrides and isolates
 * that make a name display as something other than what is stored.
 */
const INVISIBLE = /[\u00ad\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g;

/**
 * A zero-width (non-)joiner that joins nothing visible. Between two letters
 * (Persian writes one inside a word) or inside an emoji sequence it shapes
 * what is shown, so it is kept there.
 */
const STRAY_JOINER =
  /(?<![\p{L}\p{M}\p{Extended_Pictographic}\p{Emoji_Modifier}\ufe0f])[\u200c\u200d]|[\u200c\u200d](?![\p{L}\p{M}\p{Extended_Pictographic}])/gu;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The first `limit` characters as a reader counts them, never splitting an emoji or a flag. */
function cutToGraphemes(text: string, limit: number): string {
  let cut = '';
  let count = 0;
  for (const { segment } of graphemes.segment(text)) {
    if (count === limit) break;
    cut += segment;
    count += 1;
  }
  return cut;
}

/**
 * A name as typed or as a hand-edited file holds it, made safe to show and to
 * hand the model: one line, single-spaced, no control or invisible
 * characters, cut to length. Null when nothing is left — a blank name is no name.
 */
export function cleanProfileName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const oneLine = value
    .replace(INVISIBLE, '')
    .replace(STRAY_JOINER, '')
    // eslint-disable-next-line no-control-regex -- control characters are exactly what is removed
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (oneLine === '') return null;
  return cutToGraphemes(oneLine, PROFILE_NAME_LIMIT).trim();
}

/** The profile a vault's settings hold. A key that is missing, blank or not text is no name. */
export function parseProfile(settings: Readonly<Record<string, unknown>>): Profile {
  return {
    name: cleanProfileName(settings[PROFILE_NAME_KEY]),
    preferredName: cleanProfileName(settings[PROFILE_PREFERRED_NAME_KEY]),
  };
}

/** The profile with the person's change made, each name cleaned as it would be stored. */
export function changeProfile(profile: Profile, change: ProfileChange): Profile {
  const next = { ...profile, ...change };
  return { name: cleanProfileName(next.name), preferredName: cleanProfileName(next.preferredName) };
}

/**
 * The settings changes that store a profile: only the names that differ from
 * what was read, so a key the person did not touch keeps whatever the file
 * holds — even a value Atlas cannot show, such as a list or a name past the
 * limit. A blank name removes its key rather than writing an empty one.
 */
export function profileSettingsChanges(
  profile: Profile,
  previous: Profile,
): Record<string, string | null> {
  const changes: Record<string, string | null> = {};
  const name = cleanProfileName(profile.name);
  const preferredName = cleanProfileName(profile.preferredName);
  if (name !== previous.name) changes[PROFILE_NAME_KEY] = name;
  if (preferredName !== previous.preferredName) changes[PROFILE_PREFERRED_NAME_KEY] = preferredName;
  return changes;
}

/** Whether the person has given their full name — what a note's owner or author needs. */
export function hasFullName(profile: Profile): boolean {
  return profile.name !== null;
}

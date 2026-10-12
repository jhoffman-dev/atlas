/**
 * How large a Claude step's answer may be, and what its properties may hold
 * (P29-03). The answer is a model's, steered by notes anyone may have written:
 * it is held to sizes a person would write, so a runaway or hostile one is
 * refused instead of being written, logged and synced.
 */

import { remoteResourceProblem, remoteValueProblem } from './remote-resources.ts';
import { setKeyProblem } from './property-key.ts';

export const MAX_TITLE_CHARACTERS = 200;
export const MAX_BODY_CHARACTERS = 50_000;
export const MAX_WHY_CHARACTERS = 1_000;
export const MAX_PROPERTIES = 30;
export const MAX_PROPERTY_KEY_CHARACTERS = 80;
export const MAX_PROPERTY_TEXT_CHARACTERS = 2_000;
export const MAX_PROPERTY_LIST_ITEMS = 50;

/** The longest a model-authored string runs in a log line or the Activity log. */
export const MAX_LOGGED_CHARACTERS = 600;

/** `text` cut to `max` characters, with an ellipsis where it was; whole when it fits. */
export function truncated(text: string, max = MAX_LOGGED_CHARACTERS): string {
  return text.length <= max ? text : `${leading(text, max - 1)}…`;
}

/** The first `max` UTF-16 units of `text`, less one if that would cut a pair in half: an emoji is not left as a lone surrogate. */
export function leading(text: string, max: number): string {
  const last = text.charCodeAt(max - 1);
  const splitsPair = last >= 0xd800 && last <= 0xdbff && max < text.length;
  return text.slice(0, splitsPair ? max - 1 : max);
}

/** Why `text` is too long to be called `what`, or null. */
export function lengthProblem(what: string, text: string, max: number): string | null {
  return text.length > max ? `${what} is ${text.length} characters; at most ${max}.` : null;
}

/** Why the keys of `value` are not all in `allowed`, or null: an unknown key is a guess at what was meant. */
export function unknownKeyProblem(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  what: string,
): string | null {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  return unknown === undefined
    ? null
    : `${what} has “${truncated(unknown, 40)}”, which is not one of ${allowed.join(', ')}.`;
}

/**
 * Why `properties` are not properties a step may write, or null: few, named
 * as a rule would name them (none Atlas keeps), and each plain — text, a
 * number, true or false, or a short list of text — and loading nothing.
 * Nothing nests: a note's frontmatter is not a document.
 */
export function propertiesProblem(properties: unknown): string | null {
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    return 'Its properties are not keys and values.';
  }
  const entries = Object.entries(properties);
  if (entries.length > MAX_PROPERTIES) {
    return `It has ${entries.length} properties; at most ${MAX_PROPERTIES}.`;
  }
  for (const [key, value] of entries) {
    const problem =
      setKeyProblem(key) ??
      lengthProblem('A property’s name', key, MAX_PROPERTY_KEY_CHARACTERS) ??
      valueProblem(key, value);
    if (problem !== null) return problem;
  }
  return null;
}

function valueProblem(key: string, value: unknown): string | null {
  if (typeof value === 'string') return textProblem(key, value);
  if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
    return null;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    if (value.length > MAX_PROPERTY_LIST_ITEMS) {
      return `“${key}” has ${value.length} items; at most ${MAX_PROPERTY_LIST_ITEMS}.`;
    }
    for (const item of value as string[]) {
      const problem = textProblem(key, item);
      if (problem !== null) return problem;
    }
    return null;
  }
  return `“${key}” is not text, a number, true or false, or a list of text.`;
}

function textProblem(key: string, text: string): string | null {
  return lengthProblem(`“${key}”`, text, MAX_PROPERTY_TEXT_CHARACTERS) ?? remoteValueProblem(text);
}

/** Why the text a note is made of — name, body — carries something remote, or is too long; null when fine. */
export function noteTextProblem({ title, body }: { title: string; body: string }): string | null {
  return (
    lengthProblem('Its title', title, MAX_TITLE_CHARACTERS) ??
    lengthProblem('Its body', body, MAX_BODY_CHARACTERS) ??
    remoteResourceProblem(title) ??
    remoteResourceProblem(body)
  );
}

/**
 * Which property names a rule, or the answer of its Claude step, may write
 * (P25-01, P29-03): kept apart from both so each can ask without importing
 * the other.
 */

import { ARCHIVED_FROM_KEY, ARCHIVED_KEY, ARCHIVED_PRIOR_KEY } from '../archive/archive.ts';

/**
 * Keys a rule may not set: the archive's own stamp, Atlas's markers, and a
 * note's type — changing what a note is is not a property edit.
 */
const RESERVED_KEYS = new Set(
  ['atlas', 'id', 'type', ARCHIVED_KEY, ARCHIVED_FROM_KEY, ARCHIVED_PRIOR_KEY].map((key) =>
    key.toLowerCase(),
  ),
);

/** Names that, as a key of a plain object, reach its prototype rather than a property. */
const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const KEY = /^[\p{L}_][\p{L}\p{N}_ -]*$/u;

/** Why a rule may not set this key, or null when it may. */
export function setKeyProblem(key: string): string | null {
  if (!KEY.test(key) || PROTOTYPE_KEYS.has(key))
    return `“${key}” is not a property a rule can set.`;
  if (RESERVED_KEYS.has(key.toLowerCase()) || key.toLowerCase().startsWith('atlas')) {
    return `A rule cannot set “${key}”: Atlas keeps that one itself.`;
  }
  return null;
}

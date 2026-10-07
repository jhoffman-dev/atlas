import { splitWikiLinks } from '../markdown/wikilink.ts';
import { isDateLike } from '../index/property-value.ts';
import type { PropertyDef } from './property-def.ts';

/**
 * Whether a value is allowed in a property, and why not if it is not.
 *
 * Returns a message meant to be shown as it is, so it says what to do rather
 * than naming a type: "pick one of draft, done" beats "invalid enum".
 */
export function validatePropertyValue({
  def,
  value,
}: {
  def: PropertyDef;
  value: unknown;
}): string | null {
  if (isEmpty(value)) {
    // An empty thumbnail is not missing: it means `auto`, a picture of the page.
    return def.required && def.kind !== 'thumbnail' ? `${def.label} is required` : null;
  }

  switch (def.kind) {
    case 'number':
      return typeof value === 'number' || Number.isFinite(Number(value))
        ? null
        : `${def.label} must be a number`;

    case 'date':
      return isDateLike(String(value).trim())
        ? null
        : `${def.label} must be a date like 2026-09-20`;

    case 'checkbox':
      return typeof value === 'boolean' || value === 'true' || value === 'false'
        ? null
        : `${def.label} must be true or false`;

    case 'url':
      return isUrl(String(value)) ? null : `${def.label} must be a link starting with http`;

    case 'select':
      return allowedOption(def, value);

    case 'multiSelect': {
      const items = Array.isArray(value) ? value : [value];
      for (const item of items) {
        const problem = allowedOption(def, item);
        if (problem !== null) return problem;
      }
      return null;
    }

    case 'relation': {
      const items = Array.isArray(value) ? value : [value];
      if (!def.many && items.length > 1) return `${def.label} can only hold one note`;
      return items.every((item) => isWikiLink(item))
        ? null
        : `${def.label} must be a link to a ${def.target ?? 'note'}`;
    }

    case 'thumbnail':
      return typeof value === 'string' || value === false
        ? null
        : `${def.label} must be auto, a picture in the vault, or false`;

    case 'text':
      return null;
  }
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function allowedOption(def: PropertyDef, value: unknown): string | null {
  if (def.options.length === 0) return null;
  return def.options.includes(String(value))
    ? null
    : `${def.label} must be one of ${def.options.join(', ')}`;
}

function isUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** A relation is stored as a wiki link, so it stays readable in any editor. */
export function isWikiLink(value: unknown): boolean {
  const text = String(value).trim();
  const pieces = splitWikiLinks(text);
  return pieces.length === 1 && pieces[0]?.kind === 'wikiLink';
}

/** The note a relation points at, as written in the link. */
export function relationTargets(value: unknown): string[] {
  const items = Array.isArray(value) ? value : [value];
  return items.flatMap((item) => {
    const [piece] = splitWikiLinks(String(item ?? '').trim());
    return piece?.kind === 'wikiLink' ? [piece.target] : [];
  });
}

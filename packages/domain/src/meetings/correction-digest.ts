import { digestOf } from '../sources/merge.ts';

/**
 * A check of a meeting's body for the correction record: the 32-bit FNV-1a
 * Atlas already uses for notes (`digestOf`), a second 53-bit mix of the same
 * text (cyrb53, public domain) and the length — about 90 bits together, so a
 * hand edit cannot match by accident. Not a defence against someone crafting
 * a collision; the frontmatter is theirs to edit anyway. Deterministic on
 * every machine, like `digestOf`, and needs no dependency.
 */
export function correctionDigestOf(text: string): string {
  let first = 0xdeadbeef;
  let second = 0x41c6ce57;
  for (let at = 0; at < text.length; at += 1) {
    const unit = text.charCodeAt(at);
    first = Math.imul(first ^ unit, 2654435761);
    second = Math.imul(second ^ unit, 1597334677);
  }
  first =
    Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909);
  second =
    Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909);
  const mixed = 4294967296 * (2097151 & second) + (first >>> 0);
  return `${digestOf(text)}-${mixed.toString(16).padStart(14, '0')}-${text.length.toString(16)}`;
}

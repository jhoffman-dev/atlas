import type { Delete } from 'mdast';
import type { ConstructName, Info, State } from 'mdast-util-to-markdown';
import { classifyCharacter } from 'micromark-util-classify-character';

/**
 * Strikethrough written so it reads back as strikethrough (A21-03). GFM's own
 * writer puts `~~` down wherever the run starts and ends, but `~~` only opens
 * where it is left-flanking and closes where it is right-flanking, as `*`
 * does: `b~~'x~~` is no strikethrough, and neither is `~~+~~é`. Remark's
 * emphasis writer encodes the character that stops a run forming — `b` as
 * `&#x62;` — and this does the same for `~~`, by the same rule.
 */
export function writeDelete(node: Delete, _parent: unknown, state: State, info: Info): string {
  const tracker = state.createTracker(info);
  // The construct GFM's own writer enters; its name is declared by
  // mdast-util-gfm-strikethrough, which this package does not depend on.
  const exit = state.enter('strikethrough' as ConstructName);
  const before = tracker.move(MARKER);
  let between = tracker.move(
    state.containerPhrasing(node, { ...tracker.current(), before, after: '~' }),
  );
  const open = encodeInfo(info.before.charCodeAt(info.before.length - 1), between.charCodeAt(0));
  if (open.inside) between = reference(between.charCodeAt(0)) + between.slice(1);
  const close = encodeInfo(info.after.charCodeAt(0), between.charCodeAt(between.length - 1));
  if (close.inside)
    between = between.slice(0, -1) + reference(between.charCodeAt(between.length - 1));
  const after = tracker.move(MARKER);
  exit();
  state.attentionEncodeSurroundingInfo = { before: open.outside, after: close.outside };
  return before + between + after;
}

writeDelete.peek = (): string => '~';

const MARKER = '~~';

const reference = (code: number): string => `&#x${code.toString(16).toUpperCase()};`;

/**
 * Which side of a `~~` to encode so that it opens or closes: the rule
 * mdast-util-to-markdown applies to `*` (`encode-info.js`), since GFM reads
 * `~` by the same flanking rules. A letter is `undefined`, whitespace 1,
 * punctuation 2.
 */
function encodeInfo(outside: number, inside: number): { inside: boolean; outside: boolean } {
  const outsideKind = classifyCharacter(Number.isNaN(outside) ? null : outside);
  const insideKind = classifyCharacter(Number.isNaN(inside) ? null : inside);
  if (insideKind === 1) return { inside: true, outside: outsideKind !== 2 };
  if (outsideKind === undefined && insideKind === 2) return { inside: false, outside: true };
  return { inside: false, outside: false };
}

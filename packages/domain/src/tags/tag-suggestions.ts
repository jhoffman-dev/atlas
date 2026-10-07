import { isTagName, tagKey } from './tag-name.ts';
import type { TagCount } from './tag-tree.ts';

/** What typing `#` and a word offers: a tag already in use, or a new one. */
export type TagSuggestion =
  | { readonly kind: 'existing'; readonly name: string; readonly count: number }
  | { readonly kind: 'create'; readonly name: string };

/** How many tags are offered at once. */
const SHOWN = 8;

/**
 * Tags to offer for what has been typed after `#`, at most {@link SHOWN}.
 * Nothing is offered until a letter is typed, so `# ` stays a heading and
 * `#1` stays a number.
 *
 * What was typed comes first — the tag of that name, or else the offer to
 * create it — because Enter picks the first item, and typing `#idea` must
 * not end as `#ideas`. It is never cut. Then come the tags whose name starts
 * with it, then those with a nested part that does (`res` finds
 * `para/resource`), each most-used first.
 */
export function rankTagSuggestions(
  query: string,
  counts: readonly TagCount[],
): readonly TagSuggestion[] {
  if (!/^\p{L}/u.test(query)) return [];
  const wanted = tagKey(query);
  const rank = (key: string) => {
    if (key === wanted) return null;
    if (key.startsWith(wanted)) return 0;
    return key.split('/').some((part) => part.startsWith(wanted)) ? 1 : null;
  };

  const exact = counts.find((tag) => tag.key === wanted);
  const typed: TagSuggestion[] =
    exact !== undefined
      ? [{ kind: 'existing', name: exact.name, count: exact.count }]
      : isTagName(query)
        ? [{ kind: 'create', name: query }]
        : [];

  const others = counts
    .flatMap((tag) => {
      const at = rank(tag.key);
      return at === null ? [] : [{ tag, at }];
    })
    .sort(
      (left, right) =>
        left.at - right.at ||
        right.tag.count - left.tag.count ||
        left.tag.key.localeCompare(right.tag.key),
    )
    .slice(0, SHOWN - typed.length)
    .map(({ tag }) => ({ kind: 'existing' as const, name: tag.name, count: tag.count }));

  return [...typed, ...others];
}

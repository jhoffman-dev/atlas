import { isBlockId } from './block-anchor.ts';
import type { WikiLink } from './wikilink.ts';

/**
 * What a link points at inside its note, read from the part after its `#`
 * (P26-02): a block by its id, `[[Note#^abc123]]`, or a heading by its words,
 * `[[Note#Plans]]`. The link grammar (`WikiLinkReader`) cuts that part off;
 * this says what it names. `[[Note#Plans#Later]]`, Obsidian's heading under a
 * heading, names the last.
 */
export type LinkFragment =
  | { readonly kind: 'block'; readonly id: string }
  | { readonly kind: 'heading'; readonly heading: string };

/** The fragment a link's `heading` part names, or null for none. */
export function linkFragment(link: Pick<WikiLink, 'heading'>): LinkFragment | null {
  const { heading } = link;
  if (heading === null || !heading.startsWith('#')) return null;
  const rest = heading.slice(1);
  if (rest.startsWith('^') && isBlockId(rest.slice(1))) return { kind: 'block', id: rest.slice(1) };
  const last = rest.split('#').at(-1)?.trim() ?? '';
  return last === '' ? null : { kind: 'heading', heading: last };
}

/** The `heading` part a link to `fragment` is written with: `#^id`, or `#Heading`. */
export function fragmentHeading(fragment: LinkFragment): string {
  return fragment.kind === 'block' ? `#^${fragment.id}` : `#${fragment.heading}`;
}

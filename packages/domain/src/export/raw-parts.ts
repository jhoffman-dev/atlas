import type { WikiLinkOrEmbed } from '../markdown/wikilink.ts';

/** Where something is in a piece of markdown, by offset. */
export interface MarkdownSpan {
  readonly start: number;
  readonly end: number;
}

/**
 * Something in markdown the editor does not model that an export has a rule
 * for (P32-07), found by the markdown reader itself — the one that decided
 * the block was not modelled — so the export reads it as Atlas does. Code is
 * never a part: what is in it stays as it is.
 */
export type RawPart = MarkdownSpan &
  (
    | { readonly kind: 'wiki-link'; readonly link: WikiLinkOrEmbed }
    | {
        /** `![alt](address)`, or `![alt][ref]` with its definition's address. */
        readonly kind: 'image';
        readonly url: string;
        readonly alt: string;
        readonly title: string | null;
        readonly reference: boolean;
      }
    | {
        /** `[words](address)`, `[words][ref]`, `<address>` or a bare web address. */
        readonly kind: 'link';
        readonly url: string;
        readonly title: string | null;
        readonly reference: boolean;
        /** Where its words are, inside the brackets: the whole link when it has none. */
        readonly words: MarkdownSpan;
      }
    /** `[ref]: address`: where a reference link or image goes. */
    | { readonly kind: 'definition'; readonly url: string }
    /** `[^label]: …`, whole. */
    | { readonly kind: 'footnote-definition' }
    /**
     * A footnote's label, the characters between `[^` and `]`: in a
     * reference, in a definition, or in text that reads like a reference to
     * a footnote not defined here (`defined: false`).
     */
    | { readonly kind: 'footnote-label'; readonly label: string; readonly defined: boolean }
    /** HTML, inline or a block of it, comments included. */
    | { readonly kind: 'html' }
    /** The first line of a quote's text, where a callout's marker would be. */
    | { readonly kind: 'quote-opening' }
    /**
     * A block — a paragraph, a list, an item, a quote, HTML, a definition —
     * by its markdown type, and how deep it sits: what the markdown is shaped as.
     */
    | { readonly kind: 'block'; readonly type: string; readonly depth: number }
  );

/**
 * Reads the parts of a raw block's markdown, with the note's link and
 * footnote definitions in reach (each as its own markdown), so a reference
 * reads as it does in the note.
 */
export type RawPartsReader = (
  markdown: string,
  definitions: readonly string[],
) => readonly RawPart[];

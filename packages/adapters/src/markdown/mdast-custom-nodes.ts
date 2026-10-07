import type { Literal } from 'mdast';

/**
 * Markdown has no wiki links or callout markers, so both are added to mdast's node
 * registry. Declaring them rather than casting means the serializer's handler map
 * accepts them, and — the point of the exercise — their brackets are written
 * verbatim instead of being escaped into `\\[\\[Note]]`.
 */
export interface WikiLinkNode extends Literal {
  type: 'wikiLink';
}

export interface CalloutMarkerNode extends Literal {
  type: 'calloutMarker';
}

/** A `#tag`, written verbatim so a `#` opening a line is not escaped. */
export interface TagNode extends Literal {
  type: 'tag';
}

/** Inline markdown written back exactly as it was read: an unchanged image's own bytes. */
export interface VerbatimInlineNode extends Literal {
  type: 'verbatimInline';
}

declare module 'mdast' {
  interface PhrasingContentMap {
    wikiLink: WikiLinkNode;
    calloutMarker: CalloutMarkerNode;
    verbatimInline: VerbatimInlineNode;
    tag: TagNode;
  }
  interface RootContentMap {
    wikiLink: WikiLinkNode;
    calloutMarker: CalloutMarkerNode;
    verbatimInline: VerbatimInlineNode;
    tag: TagNode;
  }
}

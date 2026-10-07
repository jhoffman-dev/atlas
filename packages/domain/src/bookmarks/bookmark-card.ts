import { isArchivedPath } from '../archive/archive.ts';
import type { EditorDocument } from '../markdown/editor-node.ts';
import { nodeText } from '../markdown/node-text.ts';
import { wikiLinkLabel, type WikiLink } from '../markdown/wikilink.ts';
import { placeCrumb } from '../page/page-crumb.ts';
import { plainText } from '../markdown/plain-text.ts';
import { pageTitle } from '../page/page-title.ts';
import { cardFront, pageThumbnailSrc } from '../thumbnails/page-thumbnail.ts';
import { noteTitle } from '../vault/vault-entry.ts';
import type { VaultPath } from '../vault/vault-path.ts';

/** The properties a note can describe itself with, first found first used. */
export const SUMMARY_KEYS = ['description', 'summary'] as const;

/** How much of a summary a bookmark shows: two lines of a card, about. */
export const MAX_BOOKMARK_SUMMARY = 160;

/** What a bookmark card shows. */
export type BookmarkCard =
  | {
      /** The link names no note in the vault. */
      readonly kind: 'missing';
      /** What the link shows, to say which note is missing. */
      readonly label: string;
    }
  | {
      readonly kind: 'note';
      readonly path: VaultPath;
      readonly title: string;
      /** A line or two of what the note says; empty when it says nothing yet. */
      readonly summary: string;
      /** Where the note lives, as its page's breadcrumb says it. */
      readonly place: string;
      /** In the Archive: it opens, but is out of use. */
      readonly archived: boolean;
      /**
       * The pictures that could front the card, best first, as the note
       * writes them (relative to the note): its thumbnail — chosen, or the
       * picture of its page from the cache — then its cover or first image.
       * The first that loads is shown; with none, the card shows an icon.
       */
      readonly pictures: readonly string[];
    };

/** The card for a link that names no note. */
export function missingBookmark(link: WikiLink): BookmarkCard {
  return { kind: 'missing', label: wikiLinkLabel(link) };
}

/**
 * The card for the note a bookmark opens: its title as its page shows it,
 * its summary (`noteSummary`), where it lives, whether it is archived, and
 * the pictures that could front it.
 */
export function bookmarkCard({
  path,
  properties,
  doc,
  thumbnailKey,
}: {
  path: VaultPath;
  properties: Readonly<Record<string, unknown>>;
  doc: EditorDocument;
  /** The note's thumbnail property (`noteThumbnailKey`), or null when it has none. */
  thumbnailKey: string | null;
}): BookmarkCard {
  return {
    kind: 'note',
    path,
    title: pageTitle({ fileTitle: noteTitle(path), properties }).text,
    summary: noteSummary({ properties, doc }),
    place: placeCrumb(path).parent,
    archived: isArchivedPath(path),
    pictures: bookmarkPictures({ path, properties, doc, thumbnailKey }),
  };
}

/**
 * The pictures that could front a note's bookmark, best first and each once.
 * A thumbnail on `auto` is the picture of the page, which is kept in the
 * cache only once it has been made; behind it come the note's cover and its
 * first image, as a card whose thumbnail was cleared falls back to them.
 */
export function bookmarkPictures({
  path,
  properties,
  doc,
  thumbnailKey,
}: {
  path: VaultPath;
  properties: Readonly<Record<string, unknown>>;
  doc: EditorDocument;
  thumbnailKey: string | null;
}): string[] {
  const fronts = [
    cardFront({ properties, doc, thumbnailKey }),
    cardFront({ properties, doc, thumbnailKey: null }),
  ];
  const pictures = fronts.flatMap((front) => {
    if (front.kind === 'image') return [front.src];
    return front.kind === 'page' ? [pageThumbnailSrc(path)] : [];
  });
  return [...new Set(pictures)];
}

/**
 * What a note is about, in a line or two: its `description` or `summary`
 * when it gives one — its words, without their markdown — otherwise its
 * first paragraph. Headings are passed over
 * — the card already has the title — and so is anything that is not prose.
 * Spaces run together, and a long one is cut at a word with an ellipsis.
 */
export function noteSummary({
  properties,
  doc,
}: {
  properties: Readonly<Record<string, unknown>>;
  doc: EditorDocument;
}): string {
  for (const key of SUMMARY_KEYS) {
    const value = properties[key];
    // Read as words, as a board card or a list row shows the same property.
    const words = typeof value === 'string' ? plainText(value) : '';
    if (words !== '') return clipped(words);
  }
  for (const block of doc.content) {
    if (block.type !== 'paragraph') continue;
    const text = squeezed(nodeText(block));
    if (text !== '') return clipped(text);
  }
  return '';
}

const squeezed = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Text cut to `MAX_BOOKMARK_SUMMARY`, at the last space before it when there is one. */
function clipped(text: string): string {
  if (text.length <= MAX_BOOKMARK_SUMMARY) return text;
  const cut = text.slice(0, MAX_BOOKMARK_SUMMARY - 1);
  const space = cut.lastIndexOf(' ');
  const words = space > MAX_BOOKMARK_SUMMARY / 2 ? cut.slice(0, space) : cut;
  return `${words.replace(/[\s,;:.]+$/, '')}…`;
}

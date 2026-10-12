/**
 * What a Claude step may not write (P29-03): anything that loads from
 * somewhere else when the note is opened. A note is read out of a model's
 * answer, which a hostile note can steer; a picture whose address holds what
 * the model read is a way to send it out, seen by no one. So a step writes
 * text and links — a link loads nothing until it is clicked — and an answer
 * that carries more is refused whole, with the reason.
 */

/** Tags that load something, or run something, or restyle what loads. */
const LOADING_TAGS = [
  'img',
  'image',
  'picture',
  'source',
  'video',
  'audio',
  'track',
  'iframe',
  'frame',
  'frameset',
  'embed',
  'object',
  'applet',
  'script',
  'link',
  'style',
  'meta',
  'base',
  'form',
  'input',
  'svg',
  'math',
  'canvas',
];

const LOADING_TAG = new RegExp(`<\\s*/?\\s*(?:${LOADING_TAGS.join('|')})\\b`, 'i');

/** Attributes that fetch, restyle or run, on any tag. */
const LOADING_ATTRIBUTE =
  /<[a-z][^>]*\s(?:src|srcset|style|background|poster|data|action|formaction|ping|xlink:href|on[a-z]+)\s*=/i;

/** An address with a scheme, or a protocol-relative one: not a file in the vault. */
const REMOTE_ADDRESS = /^\s*(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** A web address standing alone as a property's value: what a thumbnail or cover property would show. */
const ADDRESS_VALUE = /^\s*(?:https?:|data:|ftp:|file:|\/\/)/i;

const INLINE_IMAGE = /^!\[[^\]]*\]\(\s*<?\s*([^)>\s]*)/;

const REASON =
  'A Claude step writes text and links, nothing that loads from somewhere else when the note is opened.';

/** Why this markdown may not be written by a step, or null when it loads nothing remote. */
export function remoteResourceProblem(markdown: string): string | null {
  for (const match of markdown.matchAll(/!\[(?!\[)/g)) {
    const image = INLINE_IMAGE.exec(markdown.slice(match.index));
    // A reference-style picture (`![alt][ref]`) takes its address from a line elsewhere: not judged, refused.
    if (image === null) return `It carries a picture by reference. ${REASON}`;
    if (REMOTE_ADDRESS.test(image[1]!)) return `It carries a remote picture. ${REASON}`;
  }
  if (LOADING_TAG.test(markdown)) return `It carries an HTML tag that loads or embeds. ${REASON}`;
  if (LOADING_ATTRIBUTE.test(markdown)) {
    return `It carries an HTML attribute that loads or restyles. ${REASON}`;
  }
  return null;
}

/** Why this property value may not be written by a step, or null: markdown rules, and no bare web address. */
export function remoteValueProblem(value: string): string | null {
  if (ADDRESS_VALUE.test(value)) {
    return `A property holds a web address (${JSON.stringify(value.trim().slice(0, 60))}). ${REASON} Put it in the body as a link.`;
  }
  return remoteResourceProblem(value);
}

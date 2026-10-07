/**
 * Whether a file's first bytes are the kind of image its name says.
 *
 * Inside the app the webview is asked to draw an image before it is saved.
 * An image sent through the local API arrives in chunks, so there is nothing
 * whole to draw until the last one; its first chunk is checked against the
 * signature every file of its kind starts with instead, so bytes that only
 * claim to be a picture are refused before anything is written.
 */

/** How far into an SVG its first tag may be, past a byte-order mark and blank space. */
const SVG_LEAD_BYTES = 1024;

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

/** The ISO media brands a HEIC or HEIF still image declares after `ftyp`. */
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

/** Why `head` is not an image of kind `extension`, or null when its signature matches. */
export function imageBytesRefusal({
  name,
  extension,
  head,
}: {
  name: string;
  /** Lower case, as `checkIncomingImage` accepted it. */
  extension: string;
  /**
   * The file's first bytes: the longest signature, WebP's and HEIC's, needs
   * twelve. An SVG is also searched for script through every byte given, so
   * the whole file is given once it is whole.
   */
  head: Uint8Array;
}): string | null {
  if (!matchesSignature(extension, head)) {
    return `“${name}” does not start the way a ${extension.toUpperCase()} image does.`;
  }
  if (extension === 'svg' && holdsScript(head)) {
    return `“${name}” holds a script or a web page, which an image in a note may not.`;
  }
  return null;
}

function matchesSignature(extension: string, head: Uint8Array): boolean {
  switch (extension) {
    case 'png':
      return startsWith(head, PNG);
    case 'jpg':
    case 'jpeg':
      return startsWith(head, JPEG);
    case 'gif':
      return ascii(head, 0, 6) === 'GIF87a' || ascii(head, 0, 6) === 'GIF89a';
    case 'webp':
      return ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP';
    case 'heic':
    case 'heif':
      return ascii(head, 4, 8) === 'ftyp' && HEIF_BRANDS.has(ascii(head, 8, 12));
    case 'svg':
      return hasSvgRoot(head);
    default:
      return false;
  }
}

function startsWith(head: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, at) => head[at] === byte);
}

function ascii(head: Uint8Array, from: number, to: number): string {
  if (head.length < to) return '';
  return String.fromCharCode(...head.subarray(from, to));
}

/**
 * What may come before an SVG's root element: blank space, an XML
 * declaration, comments, and a doctype that is not HTML's.
 */
const SVG_PROLOG = /^(?:\s+|<\?[^]*?\?>|<!--[^]*?-->|<!DOCTYPE\s+svg\b[^>]*>)*/i;

/** An SVG's root element is `<svg`, past a byte-order mark and its prolog. */
function hasSvgRoot(head: Uint8Array): boolean {
  const text = textOf(head.subarray(0, SVG_LEAD_BYTES)).replace(/^\uFEFF/, '');
  const rest = text.slice(SVG_PROLOG.exec(text)?.[0].length ?? 0);
  return /^<svg[\s/>]/.test(rest);
}

/**
 * What only a document meant to run, never a picture, needs: a script, an
 * event handler, or a web page carried inside. Found in any case, anywhere.
 */
const SCRIPTED = /<!DOCTYPE\s+html|<html[\s>]|<script[\s/>]|\son[a-z]+\s*=/i;

function holdsScript(bytes: Uint8Array): boolean {
  return SCRIPTED.test(textOf(bytes));
}

function textOf(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

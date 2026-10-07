/*
 * Base64, both ways, for a saved copy's files: images inlined as `data:` URLs
 * so a sandboxed frame can show them, and chunks of a file sent over the local
 * API as JSON. Written out rather than borrowed from `btoa`, which only takes
 * Latin-1 strings and throws on anything else.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VALUES = new Map([...ALPHABET].map((character, value) => [character, value]));
const STRICT = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function encodeBase64(bytes: Uint8Array): string {
  const out: string[] = [];
  for (let at = 0; at < bytes.length; at += 3) {
    const [a = 0, b = 0, c = 0] = [bytes[at], bytes[at + 1], bytes[at + 2]];
    const triple = (a << 16) | (b << 8) | c;
    const left = bytes.length - at;
    out.push(
      ALPHABET[(triple >> 18) & 63] ?? '',
      ALPHABET[(triple >> 12) & 63] ?? '',
      left > 1 ? (ALPHABET[(triple >> 6) & 63] ?? '') : '=',
      left > 2 ? (ALPHABET[triple & 63] ?? '') : '=',
    );
  }
  return out.join('');
}

/** The bytes, or null when the text is not canonical padded base64 — never a guess. */
export function decodeBase64(text: string): Uint8Array | null {
  if (!STRICT.test(text)) return null;
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array((text.length / 4) * 3 - padding);
  let written = 0;
  for (let at = 0; at < text.length; at += 4) {
    const quad = [0, 1, 2, 3].map((offset) => VALUES.get(text[at + offset] ?? '') ?? 0);
    const triple = quad.reduce((sum, value) => (sum << 6) | value, 0);
    for (const shift of [16, 8, 0]) {
      if (written < bytes.length) bytes[written++] = (triple >> shift) & 255;
    }
  }
  return bytes;
}

/** A `data:` URL for the bytes, which a sandboxed frame can show without fetching. */
export function dataUrl(mediaType: string, bytes: Uint8Array): string {
  return `data:${mediaType};base64,${encodeBase64(bytes)}`;
}

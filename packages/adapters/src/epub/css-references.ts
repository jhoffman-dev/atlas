/*
 * The addresses one CSS value names, read as CSS's tokenizer reads them
 * (#505, ADR-0045 §5): a `url(…)`, quoted or not; the string of a `src()`;
 * and each string an `image-set()`, `-webkit-image-set()`, `image()` or
 * `cross-fade()` takes as an address. Comments, escapes and a backslash
 * that joins two lines of a string are read as CSS reads them, so no
 * spelling hides an address. The browser's own parser has already split
 * the stylesheet into rules and declarations; this reads one value of one.
 */

/** What a value's address becomes: kept as written, or the address it is given; null drops the value. */
export type AddressMade = (ref: string) => Promise<string | 'keep' | null>;

/** Functions whose strings are addresses. `url` and `src` take one; the others take images. */
const ADDRESS_FUNCTIONS = new Set([
  'url',
  'src',
  'image-set',
  '-webkit-image-set',
  'image',
  'cross-fade',
  '-webkit-cross-fade',
]);
/** Functions whose value is not known until the page is styled: an address built from one cannot be read here. */
const UNKNOWN_FUNCTIONS = new Set(['var', 'env', 'attr']);

interface Found {
  readonly start: number;
  readonly end: number;
  readonly ref: string;
  /** How the made address is written back: a `url()` token is replaced whole, a string as a string. */
  readonly form: 'url' | 'string';
}

/**
 * `value` with every address it names made by `made`; null when any address
 * may not stay, or when one is built from a value not known here.
 */
export async function valueMade(value: string, made: AddressMade): Promise<string | null> {
  const found = addressesIn(value);
  if (found === null) return null;
  const pieces: string[] = [];
  let last = 0;
  for (const { start, end, ref, form } of found) {
    const address = await made(ref);
    if (address === null) return null;
    const written =
      address === 'keep'
        ? value.slice(start, end)
        : form === 'url'
          ? `url(${quoted(address)})`
          : quoted(address);
    pieces.push(value.slice(last, start), written);
    last = end;
  }
  pieces.push(value.slice(last));
  return pieces.join('');
}

/** Whether `css` names any address `made` would not keep as it is written. */
export async function namesAddress(css: string, made: AddressMade): Promise<boolean> {
  const found = addressesIn(css);
  if (found === null) return true;
  for (const { ref } of found) if ((await made(ref)) !== 'keep') return true;
  return false;
}

/** Each address `value` names, in order; null when one is built from `var()`, `env()` or `attr()`. */
export function addressesIn(value: string): Found[] | null {
  const found: Found[] = [];
  const open: string[] = [];
  let at = 0;
  while (at < value.length) {
    if (value.startsWith('/*', at)) {
      const close = value.indexOf('*/', at + 2);
      at = close === -1 ? value.length : close + 2;
    } else if (value[at] === '"' || value[at] === "'") {
      const string = stringAt(value, at);
      if (ADDRESS_FUNCTIONS.has(open.at(-1) ?? '')) {
        found.push({ start: at, end: string.end, ref: string.text, form: 'string' });
      }
      at = string.end;
    } else if (startsName(value, at)) {
      const name = nameAt(value, at);
      at = name.end;
      if (value[at] !== '(') continue;
      const fn = name.text.toLowerCase();
      if (UNKNOWN_FUNCTIONS.has(fn) && open.some((outer) => ADDRESS_FUNCTIONS.has(outer))) {
        return null;
      }
      const bare = fn === 'url' ? bareUrlAt(value, at + 1) : null;
      if (bare !== null) {
        found.push({ start: name.start, end: bare.end, ref: bare.text, form: 'url' });
        at = bare.end;
      } else {
        open.push(fn);
        at += 1;
      }
    } else {
      if (value[at] === '(') open.push('');
      else if (value[at] === ')') open.pop();
      at += value[at] === '\\' ? 2 : 1;
    }
  }
  return found;
}

/** The string token at `start`, its escapes read; it ends at its quote, or unclosed at a line break. */
function stringAt(css: string, start: number): { end: number; text: string } {
  const quote = css[start];
  let text = '';
  let at = start + 1;
  while (at < css.length && css[at] !== quote && !isNewline(css[at])) {
    if (css[at] === '\\') {
      const escape = escapeAt(css, at);
      text += escape.text;
      at = escape.end;
    } else {
      text += css[at];
      at += 1;
    }
  }
  return { end: Math.min(at + 1, css.length), text };
}

/** The unquoted `url(` token whose contents begin at `start`; null when a quoted string follows instead. */
function bareUrlAt(css: string, start: number): { end: number; text: string } | null {
  let at = start;
  while (isSpace(css[at])) at += 1;
  if (css[at] === '"' || css[at] === "'") return null;
  let text = '';
  while (at < css.length && css[at] !== ')') {
    if (css[at] === '\\') {
      const escape = escapeAt(css, at);
      text += escape.text;
      at = escape.end;
    } else {
      text += css[at];
      at += 1;
    }
  }
  return { end: Math.min(at + 1, css.length), text: text.trim() };
}

/** A name (an ident) at `start`, its escapes read: `u\72l` is `url`. */
function nameAt(css: string, start: number): { start: number; end: number; text: string } {
  let text = '';
  let at = start;
  while (at < css.length) {
    if (css[at] === '\\' && !isNewline(css[at + 1])) {
      const escape = escapeAt(css, at);
      text += escape.text;
      at = escape.end;
    } else if (isNameCharacter(css[at])) {
      text += css[at];
      at += 1;
    } else break;
  }
  return { start, end: at, text };
}

/**
 * The escape at `start`, a backslash: up to six hex digits and one white
 * space that ends them, a line break that is no character (in a string), or
 * the one character it stands for.
 */
function escapeAt(css: string, start: number): { end: number; text: string } {
  const next = css[start + 1];
  if (next === undefined) return { end: start + 1, text: '' };
  if (next === '\r' && css[start + 2] === '\n') return { end: start + 3, text: '' };
  if (isNewline(next)) return { end: start + 2, text: '' };
  const hex = /^[0-9a-f]{1,6}/i.exec(css.slice(start + 1, start + 7))?.[0];
  if (hex === undefined) return { end: start + 2, text: next };
  let end = start + 1 + hex.length;
  if (css[end] === '\r' && css[end + 1] === '\n') end += 2;
  else if (isSpace(css[end])) end += 1;
  const code = Number.parseInt(hex, 16);
  const ok = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
  return { end, text: ok ? String.fromCodePoint(code) : '\uFFFD' };
}

function startsName(css: string, at: number): boolean {
  const character = css[at];
  if (character === '\\') return !isNewline(css[at + 1]) && css[at + 1] !== undefined;
  return character !== undefined && /[a-z_\u0080-\uFFFF-]/i.test(character);
}

const isNameCharacter = (character: string | undefined) =>
  character !== undefined && /[\w\u0080-\uFFFF-]/.test(character);
const isNewline = (character: string | undefined) =>
  character === '\n' || character === '\r' || character === '\f';
const isSpace = (character: string | undefined) =>
  character === ' ' || character === '\t' || isNewline(character);

/** `text` as a CSS string, quoted. */
const quoted = (text: string) =>
  `"${text.replace(/[\\"]/g, '\\$&').replace(/[\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`;

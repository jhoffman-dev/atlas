import { describe, expect, it } from 'vitest';
import { imageMarkdown } from './image-placement.ts';
import { imageBytesRefusal } from './image-signature.ts';

const bytes = (...parts: (string | number[])[]) =>
  Uint8Array.from(
    parts.flatMap((part) =>
      typeof part === 'string' ? [...part].map((character) => character.charCodeAt(0)) : part,
    ),
  );

const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0x10], 'JFIF');
const GIF = bytes('GIF89a', [1, 0, 1, 0]);
const OLD_GIF = bytes('GIF87a', [1, 0, 1, 0]);
const WEBP = bytes('RIFF', [0x24, 0, 0, 0], 'WEBPVP8 ');
const HEIC = bytes([0, 0, 0, 0x18], 'ftypheic', [0, 0, 0, 0]);
const HEIF = bytes([0, 0, 0, 0x18], 'ftypmif1', [0, 0, 0, 0]);
const SVG = new TextEncoder().encode(
  '﻿  \n<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>',
);

const refusal = (extension: string, head: Uint8Array) =>
  imageBytesRefusal({ name: `a.${extension}`, extension, head });

describe('imageBytesRefusal', () => {
  it.each([
    ['png', PNG],
    ['jpg', JPEG],
    ['jpeg', JPEG],
    ['gif', GIF],
    ['gif', OLD_GIF],
    ['webp', WEBP],
    ['heic', HEIC],
    ['heif', HEIF],
    ['heic', HEIF],
    ['svg', SVG],
  ])('accepts a %s that starts as one does', (extension, head) => {
    expect(refusal(extension, head)).toBeNull();
  });

  it.each([
    ['png', JPEG],
    ['jpg', PNG],
    ['gif', bytes('GIF90a')],
    ['webp', bytes('RIFF', [0, 0, 0, 0], 'WAVE')],
    ['heic', bytes([0, 0, 0, 0x18], 'ftypisom')],
    ['heic', bytes([0, 0, 0, 0x18], 'ftyp')],
    ['svg', bytes('hello <svg/>')],
    ['svg', bytes('<!DOCTYPE html><html><body><svg/></body></html>')],
    ['svg', bytes('<html><svg/></html>')],
    ['svg', bytes('<?xml version="1.0"?><settings><password>x</password></settings>')],
    ['svg', bytes('<svgs/>')],
    ['png', bytes('<html>')],
    ['png', new Uint8Array()],
    ['bmp', bytes('BM')],
  ])('refuses a %s whose bytes say otherwise, naming the file and the kind', (extension, head) => {
    expect(refusal(extension, head)).toBe(
      `“a.${extension}” does not start the way a ${extension.toUpperCase()} image does.`,
    );
  });

  it('refuses a PNG cut short before its signature ends', () => {
    expect(refusal('png', PNG.subarray(0, 7))).not.toBeNull();
  });

  it.each([
    [
      'a prolog, a comment and a doctype',
      '<?xml version="1.0"?>\n<!-- drawn by hand -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">\n<svg viewBox="0 0 1 1"></svg>',
    ],
    ['an svg root and nothing else', '<svg>\n<rect width="1" height="1"/></svg>'],
    // Prose that looks like a handler (" ones = 1") is refused too: a looser
    // rule would have to parse attributes, and `>` is legal inside one.
    ['prose that merely mentions a script', '<svg><text>scripts, and onions</text></svg>'],
  ])('accepts an SVG with %s', (_, text) => {
    expect(refusal('svg', bytes(text))).toBeNull();
  });

  it.each([
    ['a script element', '<svg><script>alert(1)</script></svg>'],
    ['a script element in capitals', '<svg><SCRIPT>alert(1)</SCRIPT></svg>'],
    ['an event handler', '<svg onload="alert(1)"></svg>'],
    ['an event handler past a line break', '<svg><rect\n  onclick = "alert(1)"/></svg>'],
    [
      'a web page further in',
      '<svg><foreignObject><html><body></body></html></foreignObject></svg>',
    ],
    ['an HTML doctype further in', '<svg></svg><!doctype html>'],
  ])('refuses an SVG holding %s, anywhere in it', (_, text) => {
    expect(refusal('svg', bytes(text))).toBe(
      '“a.svg” holds a script or a web page, which an image in a note may not.',
    );
  });
});

describe('imageMarkdown', () => {
  it('writes the image with its alt text and source', () => {
    expect(imageMarkdown({ alt: 'Q3 chart', src: 'attachments/Q3%20chart.png' })).toBe(
      '![Q3 chart](attachments/Q3%20chart.png)',
    );
  });

  it('escapes brackets and backslashes, and folds line breaks, so the alt cannot close early', () => {
    expect(imageMarkdown({ alt: ' a]b\\c[\nd ', src: 'x.png' })).toBe('![a\\]b\\\\c\\[ d](x.png)');
  });

  it('writes an image with no alt text', () => {
    expect(imageMarkdown({ alt: '', src: 'x.png' })).toBe('![](x.png)');
  });
});

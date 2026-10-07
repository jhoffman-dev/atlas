import { describe, expect, it } from 'vitest';
import {
  checkIncomingImage,
  defaultAltText,
  IMAGE_PICKER_ACCEPT,
  imageFileName,
  imageMimeType,
  MAX_IMAGE_BYTES,
  numberedFileName,
  undrawableImageMessage,
  type IncomingImage,
} from './image-file.ts';

const NOW = '2026-09-25T14:30:12';

const image = (overrides: Partial<IncomingImage> = {}): IncomingImage => ({
  name: 'Diagram.png',
  mimeType: 'image/png',
  size: 1024,
  origin: 'file',
  ...overrides,
});

describe('checkIncomingImage', () => {
  it.each(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic', 'heif', 'PNG', 'JPG'])(
    'accepts a .%s file',
    (extension) => {
      expect(checkIncomingImage(image({ name: `a.${extension}`, mimeType: '' }))).toEqual({
        kind: 'accepted',
        extension: extension.toLowerCase(),
      });
    },
  );

  it.each(['tiff', 'bmp', 'pdf', 'txt', 'html'])('refuses a .%s file, naming it', (extension) => {
    const check = checkIncomingImage(image({ name: `a.${extension}`, mimeType: '' }));
    expect(check).toEqual({
      kind: 'refused',
      message: `“a.${extension}” is not an image a note can hold. Use PNG, JPEG, GIF, WebP, SVG or HEIC.`,
    });
  });

  it('takes the kind from the MIME type when the name has none', () => {
    expect(checkIncomingImage(image({ name: '', mimeType: 'image/png' }))).toEqual({
      kind: 'accepted',
      extension: 'png',
    });
    expect(checkIncomingImage(image({ name: 'Screenshot', mimeType: 'image/jpeg' }))).toEqual({
      kind: 'accepted',
      extension: 'jpeg',
    });
  });

  it('lets the extension win over a MIME type that disagrees', () => {
    expect(checkIncomingImage(image({ name: 'a.gif', mimeType: 'image/png' }))).toMatchObject({
      extension: 'gif',
    });
  });

  it('refuses an unnamed paste of a kind it cannot take, as "the pasted image"', () => {
    const check = checkIncomingImage(image({ name: '', mimeType: 'image/tiff' }));
    expect(check).toMatchObject({ kind: 'refused' });
    expect(check.kind === 'refused' && check.message).toMatch(/^The pasted image is not/);
  });

  it('refuses an empty file', () => {
    expect(checkIncomingImage(image({ size: 0 }))).toEqual({
      kind: 'refused',
      message: '“Diagram.png” is empty.',
    });
  });

  it('takes exactly the size cap and refuses one byte past it', () => {
    expect(checkIncomingImage(image({ size: MAX_IMAGE_BYTES })).kind).toBe('accepted');
    expect(checkIncomingImage(image({ size: MAX_IMAGE_BYTES + 1 }))).toEqual({
      kind: 'refused',
      message: '“Diagram.png” is 20.0 MB. An image in a note can be at most 20 MB.',
    });
  });
});

describe('imageFileName', () => {
  it('keeps a file’s own name, with the extension it was checked as', () => {
    expect(imageFileName({ image: image({ name: 'Photo.JPG' }), extension: 'jpg', now: NOW })).toBe(
      'Photo.jpg',
    );
  });

  it('names a paste by the local time, as Obsidian does', () => {
    expect(imageFileName({ image: image({ name: '' }), extension: 'png', now: NOW })).toBe(
      'Pasted image 20260925143012.png',
    );
  });

  it('treats a clipboard’s generic image.png as no name at all', () => {
    const pasted = image({ name: 'image.png', origin: 'clipboard' });
    expect(imageFileName({ image: pasted, extension: 'png', now: NOW })).toBe(
      'Pasted image 20260925143012.png',
    );
  });

  it('keeps a dropped file that really is called image.png', () => {
    expect(imageFileName({ image: image({ name: 'image.png' }), extension: 'png', now: NOW })).toBe(
      'image.png',
    );
  });

  it('keeps a pasted file with a real name', () => {
    const pasted = image({ name: 'Team photo.webp', origin: 'clipboard' });
    expect(imageFileName({ image: pasted, extension: 'webp', now: NOW })).toBe('Team photo.webp');
  });

  it('cleans out what no filesystem accepts', () => {
    const odd = image({ name: 'a/b:c*?.png' });
    expect(imageFileName({ image: odd, extension: 'png', now: NOW })).toBe('a b c.png');
  });

  it('falls back to the pasted name when cleaning leaves nothing', () => {
    expect(imageFileName({ image: image({ name: '???.png' }), extension: 'png', now: NOW })).toBe(
      'Pasted image 20260925143012.png',
    );
  });
});

describe('numberedFileName', () => {
  it('keeps a free name', () => {
    expect(numberedFileName({ name: 'a.png', taken: ['b.png'] })).toBe('a.png');
  });

  it('numbers a taken name the way Finder does, from 2', () => {
    expect(numberedFileName({ name: 'a.png', taken: ['a.png', 'a 2.png'] })).toBe('a 3.png');
  });

  it('counts a name taken in another case as taken', () => {
    expect(numberedFileName({ name: 'Photo.png', taken: ['photo.PNG'] })).toBe('Photo 2.png');
  });

  it('numbers a name with no extension', () => {
    expect(numberedFileName({ name: 'README', taken: ['README'] })).toBe('README 2');
  });
});

describe('defaultAltText', () => {
  it('is the file’s name without its extension', () => {
    expect(defaultAltText(image({ name: 'Q3 chart.png' }))).toBe('Q3 chart');
  });

  it('is empty for a paste', () => {
    expect(defaultAltText(image({ name: 'image.png', origin: 'clipboard' }))).toBe('');
    expect(defaultAltText(image({ name: '' }))).toBe('');
  });
});

describe('imageMimeType', () => {
  it.each([
    ['a.png', 'image/png'],
    ['dir/a.JPG', 'image/jpeg'],
    ['a.svg', 'image/svg+xml'],
    ['a.heic', 'image/heic'],
    ['a.avif', 'image/avif'],
    ['a.md', 'application/octet-stream'],
    ['noextension', 'application/octet-stream'],
  ])('%s is %s', (path, mime) => {
    expect(imageMimeType(path)).toBe(mime);
  });
});

describe('undrawableImageMessage', () => {
  it('says what to do with a HEIC photo the Mac cannot draw', () => {
    expect(undrawableImageMessage({ name: 'IMG_1.heic', extension: 'heic' })).toBe(
      '“IMG_1.heic” is a HEIC photo this Mac cannot show here. Export it as JPEG or PNG first.',
    );
  });

  it('says anything else could not be read', () => {
    expect(undrawableImageMessage({ name: '', extension: 'png' })).toBe(
      'The pasted image could not be read as an image.',
    );
  });
});

it('offers the picker every kind a note can hold', () => {
  expect(IMAGE_PICKER_ACCEPT).toBe('.png,.jpg,.jpeg,.gif,.webp,.svg,.heic,.heif');
});

describe('numberedFileName, on a disk that normalises Unicode', () => {
  it('counts a name taken in another Unicode normal form as taken, as APFS does', () => {
    const composed = 'caf\u00e9.png';
    const decomposed = 'cafe\u0301.png';
    const name = numberedFileName({ name: composed, taken: [decomposed] });
    expect(name.normalize('NFC')).not.toBe(composed);
  });
});

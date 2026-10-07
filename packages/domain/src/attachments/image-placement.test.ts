import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { resolveImageSource } from '../markdown/image-source.ts';
import {
  decodeImageSource,
  imageFolderFor,
  isImagePlacement,
  relativeImageSource,
} from './image-placement.ts';

const path = createVaultPath;

describe('imageFolderFor', () => {
  it('puts images in attachments/ at the root, wherever the note is', () => {
    expect(imageFolderFor({ notePath: path('Work/Plans/q3.md'), placement: 'attachments' })).toBe(
      'attachments',
    );
  });

  it('puts images beside the note when asked', () => {
    expect(imageFolderFor({ notePath: path('Work/Plans/q3.md'), placement: 'beside-note' })).toBe(
      'Work/Plans',
    );
    expect(imageFolderFor({ notePath: path('q3.md'), placement: 'beside-note' })).toBe('');
  });
});

describe('relativeImageSource', () => {
  const cases: [note: string, image: string, src: string][] = [
    ['today.md', 'attachments/a.png', 'attachments/a.png'],
    ['Work/today.md', 'attachments/a.png', '../attachments/a.png'],
    ['Work/Plans/q3.md', 'attachments/a.png', '../../attachments/a.png'],
    ['Work/q3.md', 'Work/a.png', 'a.png'],
    ['Work/q3.md', 'Work/img/a.png', 'img/a.png'],
    ['attachments/note.md', 'attachments/a.png', 'a.png'],
    ['Work/q3.md', 'Workshop/a.png', '../Workshop/a.png'],
  ];

  it.each(cases)('from %s to %s is %s', (note, image, src) => {
    expect(relativeImageSource({ notePath: path(note), imagePath: path(image) })).toBe(src);
  });

  it('percent-encodes spaces, brackets and parentheses so the link needs no escaping', () => {
    expect(
      relativeImageSource({
        notePath: path('My notes/today.md'),
        imagePath: path('attachments/Pasted image (1) [x] #2.png'),
      }),
    ).toBe('../attachments/Pasted%20image%20%281%29%20%5Bx%5D%20%232.png');
  });

  it.each([
    ['today.md', 'attachments/Pasted image 20260925143012.png'],
    ['Deep/er/note.md', 'attachments/a b (c) #d %e.png'],
    ['Deep/er/note.md', 'Deep/er/é ü.png'],
  ])('resolves back to the same file from %s', (note, image) => {
    const src = relativeImageSource({ notePath: path(note), imagePath: path(image) });
    expect(resolveImageSource({ src, notePath: path(note) })).toEqual({
      kind: 'vault',
      path: image,
    });
  });
});

describe('decodeImageSource', () => {
  it('decodes percent escapes', () => {
    expect(decodeImageSource('a%20b.png')).toBe('a b.png');
  });

  it('keeps a lone % that is not an escape', () => {
    expect(decodeImageSource('100% done.png')).toBe('100% done.png');
  });
});

describe('isImagePlacement', () => {
  it('knows the two placements and nothing else', () => {
    expect(isImagePlacement('attachments')).toBe(true);
    expect(isImagePlacement('beside-note')).toBe(true);
    expect(isImagePlacement('elsewhere')).toBe(false);
    expect(isImagePlacement(null)).toBe(false);
  });
});

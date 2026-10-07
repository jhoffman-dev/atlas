import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { resolveImageSource } from './image-source.ts';

const from = (src: string, note = 'Notes/today.md') =>
  resolveImageSource({ src, notePath: createVaultPath(note) });

describe('resolveImageSource', () => {
  it('resolves a path next to the note', () => {
    expect(from('pic.png')).toEqual({ kind: 'vault', path: 'Notes/pic.png' });
  });

  it('resolves a subfolder of the note folder', () => {
    expect(from('images/pic.png')).toEqual({ kind: 'vault', path: 'Notes/images/pic.png' });
  });

  it('resolves relative to the root for a note at the top level', () => {
    expect(from('pic.png', 'today.md')).toEqual({ kind: 'vault', path: 'pic.png' });
  });

  it('treats a leading slash as vault-relative', () => {
    expect(from('/assets/pic.png')).toEqual({ kind: 'vault', path: 'Notes/assets/pic.png' });
  });

  it.each(['https://example.com/a.png', 'http://example.com/a.png', 'data:image/png;base64,AAA'])(
    'leaves %j as an external source',
    (src) => {
      expect(from(src)).toEqual({ kind: 'external', url: src });
    },
  );

  it('decodes a percent-encoded path, as Obsidian and CommonMark tools write one', () => {
    expect(from('../attachments/Pasted%20image%201.png')).toEqual({
      kind: 'vault',
      path: 'attachments/Pasted image 1.png',
    });
  });

  it('keeps an encoded # as part of the name, after the fragment is dropped', () => {
    expect(from('a%232.png#small')).toEqual({ kind: 'vault', path: 'Notes/a#2.png' });
  });

  it('drops a fragment before resolving', () => {
    expect(from('pic.png#small')).toEqual({ kind: 'vault', path: 'Notes/pic.png' });
  });

  it('refuses a path that climbs out of the vault', () => {
    expect(from('../../../etc/passwd', 'a.md')).toEqual({ kind: 'unresolved' });
  });

  it.each(['', '   '])('returns unresolved for a blank source (%j)', (src) => {
    expect(from(src)).toEqual({ kind: 'unresolved' });
  });

  it('falls back to the vault root when the note folder would escape', () => {
    expect(from('../shared/pic.png')).toEqual({ kind: 'vault', path: 'shared/pic.png' });
  });
});

describe('resolveImageSource, told which files are in the vault', () => {
  const inVault =
    (...paths: string[]) =>
    (path: string) =>
      paths.includes(path);
  const resolve = (src: string, note: string, exists: (path: string) => boolean) =>
    resolveImageSource({ src, notePath: createVaultPath(note), exists });

  it('takes the file beside the note when it is there', () => {
    const exists = inVault('Notes/attachments/x.png', 'attachments/x.png');
    expect(resolve('attachments/x.png', 'Notes/a.md', exists)).toEqual({
      kind: 'vault',
      path: 'Notes/attachments/x.png',
    });
  });

  it('falls back to the vault root when the note folder has no such file', () => {
    expect(resolve('attachments/x.png', 'Notes/a.md', inVault('attachments/x.png'))).toEqual({
      kind: 'vault',
      path: 'attachments/x.png',
    });
  });

  it('names the note-relative file when neither is there, so it shows as missing', () => {
    expect(resolve('x.png', 'Notes/a.md', () => false)).toEqual({
      kind: 'vault',
      path: 'Notes/x.png',
    });
  });
});

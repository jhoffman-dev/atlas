import { describe, expect, it } from 'vitest';
import { describeSharedChunk, sharedChunks, type Manifest } from './shared-chunks.ts';

const ENTRY = { file: 'assets/index-A1.js', name: 'index', src: 'index.html', isEntry: true };

const part = (name: string, src: string, imports: string[] = ['index.html']) => ({
  file: `assets/${name}-B2.js`,
  name,
  src,
  isDynamicEntry: true,
  imports,
});

/** Today's shape: every part imports only the entry. */
const CLEAN: Manifest = {
  'index.html': { ...ENTRY, imports: [] },
  'src/later-parts.ts': part('later-parts', 'src/later-parts.ts'),
  'src/graph/graph-page.tsx': part('graph-page', 'src/graph/graph-page.tsx'),
};

/** PR #547's shape: Ask in a chunk of its own, the chat parts it shares split out under both. */
const SHARED: Manifest = {
  'index.html': ENTRY,
  'src/later-parts.ts': part('later-parts', 'src/later-parts.ts', ['index.html', '_chat-C3.js']),
  'src/ask/ask-screen.tsx': part('ask-screen', 'src/ask/ask-screen.tsx', [
    'index.html',
    '_chat-C3.js',
  ]),
  '_chat-C3.js': { file: 'assets/chat-C3.js', name: 'chat', imports: ['index.html'] },
};

describe('a chunk shared under a part', () => {
  it('is none when every part imports only the entry chunk', () => {
    expect(sharedChunks(CLEAN, [])).toEqual([]);
  });

  it('is found under later-parts, and under every other part that imports it', () => {
    expect(sharedChunks(SHARED, [])).toEqual([
      {
        part: 'later-parts',
        chunk: 'assets/chat-C3.js',
        importedBy: ['src/ask/ask-screen.tsx', 'src/later-parts.ts'],
      },
      {
        part: 'ask-screen',
        chunk: 'assets/chat-C3.js',
        importedBy: ['src/ask/ask-screen.tsx', 'src/later-parts.ts'],
      },
    ]);
  });

  it('is found when one part imports another part statically', () => {
    const manifest: Manifest = {
      'index.html': ENTRY,
      'src/reader/document-reader.tsx': part('document-reader', 'src/reader/document-reader.tsx', [
        'index.html',
        'src/reader/app-pdf-reader.ts',
      ]),
      'src/reader/app-pdf-reader.ts': part('app-pdf-reader', 'src/reader/app-pdf-reader.ts'),
    };
    expect(sharedChunks(manifest, []).map((shared) => shared.chunk)).toEqual([
      'assets/app-pdf-reader-B2.js',
    ]);
  });

  it('lets a known import through, and only that one', () => {
    const known = [{ part: 'ask-screen', imports: 'chat' }];
    expect(sharedChunks(SHARED, known).map((shared) => shared.part)).toEqual(['later-parts']);
  });

  it('does not judge the entry chunk, which may import what it likes', () => {
    const manifest: Manifest = {
      'index.html': { ...ENTRY, imports: ['_vendor-D4.js'] },
      '_vendor-D4.js': { file: 'assets/vendor-D4.js' },
    };
    expect(sharedChunks(manifest, [])).toEqual([]);
  });

  it('is described by the chunk, the part and the modules that pulled it in', () => {
    const [first] = sharedChunks(SHARED, []);
    const message = describeSharedChunk(first!);
    expect(message).toContain(
      "assets/chat-C3.js is shared under the part 'later-parts': it imports it statically",
    );
    expect(message).toContain('Pulled in by: src/ask/ask-screen.tsx, src/later-parts.ts');
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { BookFiles } from './book-files.ts';
import { makeChapterSafe } from './chapter-safety.ts';
import { chapterSource } from './chapter-source.ts';
import { chapterText } from './chapter-text.ts';
import { buildChapter } from './frame-bootstrap.ts';
import { offsetAt } from './text-positions.ts';

/*
 * A safe chapter as its frame is handed it (#505, ADR-0045): nodes as plain
 * data, built again by the frame into the same tree, each text saying
 * where its words begin in the chapter's text.
 */

const NO_FILES: BookFiles = {
  address: async () => null,
  stylesheet: async () => '',
  css: async (css) => css,
};

async function handed(doc: Document, path = 'OEBPS/one.xhtml') {
  makeChapterSafe(doc, path);
  const text = chapterText(doc);
  const source = await chapterSource({ chapter: doc, text, path, files: NO_FILES });
  const frame = document.implementation.createHTMLDocument('');
  const runs = buildChapter(frame, source.nodes, source.length);
  return { text, source, frame, runs };
}

describe('a safe chapter, as its frame is handed it', () => {
  it('is built by the frame into the same words, with each word at the same offset', async () => {
    const doc = new DOMParser().parseFromString(
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>T</title></head><body><h1>One</h1><p>Two <em>three</em></p><!-- a note --></body></html>',
      'application/xhtml+xml',
    );
    const { text, frame, runs } = await handed(doc);
    expect(frame.body.textContent).toBe('OneTwo three');
    const em = frame.getElementsByTagName('em')[0]?.firstChild as Text;
    expect(runs === null ? null : offsetAt(runs, em, 2)).toBe(text.text.indexOf('three') + 2);
    expect(runs?.length).toBe(text.length);
  });

  it("names a chapter read as HTML by its elements' own names, not their capitals", async () => {
    const doc = new DOMParser().parseFromString('<p>Not <b>well</b> formed', 'text/html');
    const { source, frame } = await handed(doc);
    expect(source.nodes[0]?.[3]).toBe('html');
    expect(frame.documentElement.localName).toBe('html');
    expect(frame.getElementsByTagName('b')).toHaveLength(1);
  });
});

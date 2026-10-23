// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  fablesFixtureEpub,
  hostileFixtureEpub,
  HOSTILE_ORIGIN,
} from '../../../../tools/epub/fixture-epub.ts';
import { chapterWithFiles } from './chapter-files.ts';
import { makeChapterSafe } from './chapter-safety.ts';
import { chapterText } from './chapter-text.ts';
import { foliateEpubReader } from './foliate-reader.ts';
import { openArchive } from './zip-loader.ts';

/*
 * A hostile book made safe to show (#505): the chapter of
 * tools/epub/fixture-epub.ts that tries scripts in every form, files on
 * another site, frames, a refresh, a form and links out keeps none of them,
 * keeps its one link inside the book, and keeps every node where it was, so
 * its text and its CFIs are the book's.
 */

const PATH = 'OEBPS/hostile.xhtml';

async function hostileChapter() {
  const archive = await openArchive(new Uint8Array(hostileFixtureEpub()));
  const source = (await archive.loadText(PATH)) ?? '';
  const parse = () => new DOMParser().parseFromString(source, 'application/xhtml+xml');
  const safe = parse();
  makeChapterSafe(safe, PATH);
  const shown = await chapterWithFiles({
    chapter: safe,
    path: PATH,
    address: async (path) => `blob:dfai-test/${path}`,
    archive,
  });
  return { original: parse(), safe, shown };
}

const everyElement = (doc: Document) => Array.from(doc.getElementsByTagName('*'));
/** How many elements each element holds, in document order: what a CFI's even steps count. */
const shapeOf = (doc: Document) => everyElement(doc).map((element) => element.children.length);

describe('a hostile chapter made safe', () => {
  it('keeps no script, frame, plug-in, refresh or base', async () => {
    const { shown } = await hostileChapter();
    const names = new Set(everyElement(shown).map((element) => element.localName.toLowerCase()));
    for (const banned of ['script', 'iframe', 'object', 'embed', 'meta', 'base', 'link']) {
      expect(names.has(banned), banned).toBe(false);
    }
  });

  it('keeps no handler, and nothing anywhere that names the other site or runs a script', async () => {
    const { shown } = await hostileChapter();
    const attributes = everyElement(shown).flatMap((element) => Array.from(element.attributes));
    expect(attributes.length).toBeGreaterThan(10);
    expect(attributes.filter((attribute) => attribute.localName.startsWith('on'))).toEqual([]);
    const markup = new XMLSerializer().serializeToString(shown);
    expect(markup).not.toContain(HOSTILE_ORIGIN);
    expect(markup).not.toContain('beacon.example.com');
    expect(markup.toLowerCase()).not.toContain('javascript:');
    expect(markup).not.toContain('action=');
  });

  it('keeps its link inside the book as where it leads, and a link out as going nowhere', async () => {
    const { shown } = await hostileChapter();
    const inside = shown.getElementById('inside');
    expect(inside?.getAttribute('data-dfai-path')).toBe('OEBPS/calm.xhtml');
    expect(inside?.getAttribute('data-dfai-fragment')).toBe('calm');
    expect(inside?.getAttribute('href')).toBe('#');
    const out = shown.getElementById('out');
    expect(out?.getAttribute('href')).toBe('#');
    expect(out?.hasAttribute('data-dfai-path')).toBe(false);
    expect(shown.getElementById('js')?.hasAttribute('data-dfai-path')).toBe(false);
  });

  it("puts the book's own stylesheet in as a style, its other site's import and pictures as nothing", async () => {
    const { shown } = await hostileChapter();
    const styles = Array.from(
      shown.getElementsByTagName('style'),
      (style) => style.textContent ?? '',
    );
    expect(styles.some((css) => css.includes('text-indent: 1em'))).toBe(true);
    const own = styles.join('\n');
    expect(own).not.toContain('@import');
    expect(own).toContain('background-image: none');
    expect(own).toContain('src: none');
  });

  it("gives a picture of the book's own its address, and drops one on another site", async () => {
    const { shown } = await hostileChapter();
    const images = Array.from(shown.getElementsByTagName('img'));
    expect(images.map((image) => image.getAttribute('src'))).toEqual([
      null,
      'blob:dfai-test/OEBPS/missing.png',
    ]);
  });

  it('keeps every node where it was, so its text is the same and its CFIs name the same places', async () => {
    const { original, safe, shown } = await hostileChapter();
    expect(shapeOf(safe)).toEqual(shapeOf(original));
    expect(shapeOf(shown)).toEqual(shapeOf(original));
    expect(chapterText(shown).text).toBe(chapterText(original).text);
    expect(chapterText(shown).text).not.toContain('__hostileRan');
  });

  it('gives the reader none of the scripts as words', async () => {
    const book = await foliateEpubReader().open(new Uint8Array(hostileFixtureEpub()));
    const text = await book.sectionText(0);
    expect(text).toContain('A Hare one day ridiculed');
    expect(text).not.toContain('__hostileRan');
    expect(text).not.toContain('fetch(');
    book.close();
  });
});

describe('a calm chapter made safe', () => {
  it('changes nothing a reader sees', async () => {
    const archive = await openArchive(new Uint8Array(fablesFixtureEpub()));
    const source = (await archive.loadText('OEBPS/hare.xhtml')) ?? '';
    const original = new DOMParser().parseFromString(source, 'application/xhtml+xml');
    const safe = new DOMParser().parseFromString(source, 'application/xhtml+xml');
    makeChapterSafe(safe, 'OEBPS/hare.xhtml');
    expect(safe.body?.innerHTML ?? safe.documentElement.textContent).toBe(
      original.body?.innerHTML ?? original.documentElement.textContent,
    );
  });
});

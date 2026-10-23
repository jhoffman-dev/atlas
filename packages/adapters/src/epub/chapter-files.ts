import { bookCss, type FileAddress } from './chapter-styles.ts';
import { resourceAttribute, STYLESHEET_PATH } from './chapter-safety.ts';
import type { BookArchive } from './zip-loader.ts';

/*
 * A safe chapter given its files (#505): a copy of it in which each picture,
 * font and stylesheet of the book that `makeChapterSafe` kept by its path is
 * given the address the frame loads it from — a `blob:` of the file's bytes,
 * read from the book — and each stylesheet `<link>` becomes a `<style>` in
 * the same place. Nothing else changes: the copy has the chapter's nodes,
 * so its text and CFIs are the chapter's.
 */

const XHTML = 'http://www.w3.org/1999/xhtml';

/** The attributes a kept file's path is held under, and the attribute its address goes back in. */
const RESOURCES = ['src', 'href', 'poster', 'background', 'data'];

export async function chapterWithFiles({
  chapter,
  path,
  address,
  archive,
}: {
  chapter: Document;
  path: string;
  address: FileAddress;
  archive: Pick<BookArchive, 'loadText'>;
}): Promise<Document> {
  const copy = chapter.cloneNode(true) as Document;
  const stylesheet = (sheet: string) => archive.loadText(sheet);
  const css = (text: string, from: string) => bookCss({ css: text, from, address, stylesheet });
  for (const element of Array.from(copy.getElementsByTagName('*'))) {
    await giveFiles(element, address);
    const sheet = element.getAttribute(STYLESHEET_PATH);
    if (sheet !== null) {
      const style = copy.createElementNS(XHTML, 'style');
      style.textContent = await css((await stylesheet(sheet)) ?? '', sheet);
      element.replaceWith(style);
      continue;
    }
    if (element.localName.toLowerCase() === 'style' && element.textContent !== null) {
      element.textContent = await css(element.textContent, path);
    }
    const inline = element.getAttribute('style');
    if (inline !== null) element.setAttribute('style', await css(inline, path));
  }
  return copy;
}

/** Puts back each file the element loads, at its address; one the book does not have stays unloaded. */
async function giveFiles(element: Element, address: FileAddress): Promise<void> {
  for (const name of RESOURCES) {
    const kept = element.getAttribute(resourceAttribute(name));
    if (kept === null) continue;
    const found = await address(kept);
    if (found !== null) element.setAttribute(name, found);
  }
}

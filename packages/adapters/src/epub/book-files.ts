import { bookCss, bookDeclarations } from './chapter-styles.ts';
import type { BookArchive } from './zip-loader.ts';

/*
 * A book's own files, as a chapter's frame is given them (#505, ADR-0045):
 * each picture and font a `data:` address of its bytes, read from the book,
 * and each stylesheet its CSS with every reference made one of those. A
 * `data:` document is opaque wherever it is opened, so a picture of the book
 * that holds a script can never run it as the app — a `blob:` of the app's
 * origin could. Each is read once per open book and kept: a stylesheet most
 * chapters share is made once, not once a chapter.
 */

export interface BookFiles {
  /** The book's file at `path` as a `data:` address, or null when the book has no such file. */
  address(path: string): Promise<string | null>;
  /** The book's stylesheet at `path`, its references made the book's own or nothing; empty when there is none. */
  stylesheet(path: string): Promise<string>;
  /** `css`, a `<style>` written in the book's file at `from`, made the same way. */
  css(css: string, from: string): Promise<string>;
  /** `style`, a `style=` written in the book's file at `from`, made the same way. */
  declarations(style: string, from: string): Promise<string>;
}

export function bookFiles(archive: Pick<BookArchive, 'loadText' | 'loadBlob'>): BookFiles {
  const addresses = new Map<string, Promise<string | null>>();
  const sheets = new Map<string, Promise<string>>();
  const address = (path: string) =>
    held(addresses, path, async () => {
      const blob = await archive.loadBlob(path, mediaTypeOf(path));
      return blob === null ? null : dataAddress(blob);
    });
  const css = (text: string, from: string) =>
    bookCss({ css: text, from, address, stylesheet: (path) => archive.loadText(path) });
  return {
    address,
    css,
    declarations: (style, from) => bookDeclarations({ style, from, address }),
    stylesheet: (path) =>
      held(sheets, path, async () => css((await archive.loadText(path)) ?? '', path)),
  };
}

/** What `make` answers for `key`, made once; one that failed is made again the next time it is asked for. */
function held<T>(cache: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> {
  const found = cache.get(key);
  if (found !== undefined) return found;
  const made = make();
  cache.set(key, made);
  made.catch(() => cache.delete(key));
  return made;
}

function dataAddress(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('the file could not be read'));
    reader.readAsDataURL(blob);
  });
}

/** A file's type by its name: an SVG picture is drawn only when its address says it is one. */
export function mediaTypeOf(path: string): string {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return MEDIA_TYPES[extension] ?? 'application/octet-stream';
}

const MEDIA_TYPES: Readonly<Record<string, string>> = {
  css: 'text/css',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  otf: 'font/otf',
  ttf: 'font/ttf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
};

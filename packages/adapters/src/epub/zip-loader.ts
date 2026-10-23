import {
  BlobReader,
  BlobWriter,
  configure,
  TextWriter,
  ZipReader,
  type ZipEntry,
} from 'foliate-js/vendor/zip.js';
import type { Loader } from 'foliate-js/epub.js';

/*
 * An EPUB's archive, read from its bytes with the zip.js foliate-js vendors
 * (#505): each file by its path, as text or as a blob. Nothing is fetched:
 * the bytes are already here, and zip.js is told to start no worker.
 */

/** The book's archive, as foliate-js's parser reads it, and the names of every file in it. */
export interface BookArchive extends Loader {
  readonly entries: readonly string[];
  loadText(name: string): Promise<string | null>;
  loadBlob(name: string, type?: string): Promise<Blob | null>;
}

export async function openArchive(bytes: Uint8Array): Promise<BookArchive> {
  configure({ useWebWorkers: false });
  // A copy, so the caller's bytes stay theirs whatever the archive does with its own.
  const reader = new ZipReader(new BlobReader(new Blob([bytes.slice()])));
  const files = new Map<string, ZipEntry>();
  for (const entry of await reader.getEntries()) {
    if (!entry.directory) files.set(entry.filename, entry);
  }
  return {
    entries: [...files.keys()],
    loadText: async (name) => (await files.get(name)?.getData(new TextWriter())) ?? null,
    loadBlob: async (name, type) => (await files.get(name)?.getData(new BlobWriter(type))) ?? null,
    getSize: (name) => files.get(name)?.uncompressedSize ?? 0,
    sha1: async (text) =>
      new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))),
  };
}

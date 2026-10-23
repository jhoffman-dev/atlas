/*
 * The parts of foliate-js (MIT, pinned in package.json) the EPUB adapter uses,
 * typed as it uses them. foliate-js is plain JavaScript and ships no types.
 */

declare module 'foliate-js/vendor/zip.js' {
  export function configure(options: { useWebWorkers: boolean }): void;
  export class BlobReader {
    constructor(blob: Blob);
  }
  export class TextWriter {
    private readonly writes: 'text';
  }
  export class BlobWriter {
    constructor(type?: string);
    private readonly writes: 'blob';
  }
  export interface ZipEntry {
    readonly filename: string;
    readonly directory: boolean;
    readonly uncompressedSize: number;
    getData(writer: TextWriter): Promise<string>;
    getData(writer: BlobWriter): Promise<Blob>;
  }
  export class ZipReader {
    constructor(reader: BlobReader);
    getEntries(): Promise<ZipEntry[]>;
    close(): Promise<void>;
  }
}

declare module 'foliate-js/epubcfi.js' {
  /** A CFI broken into its steps, as `parse` gives it. */
  export type CfiParts = unknown;
  export function parse(cfi: string): CfiParts;
  export function fromRange(range: Range): string;
  export function toRange(doc: Document, parts: CfiParts): Range;
  export function joinIndir(...cfis: string[]): string;
}

declare module 'foliate-js/epub.js' {
  /** What the book's package says, as foliate-js maps it; a text may be a map of languages. */
  export type LanguageMap = string | Readonly<Record<string, string>>;
  export interface Contributor {
    readonly name?: LanguageMap | null;
  }
  export interface EpubMetadata {
    readonly title?: LanguageMap | null;
    /** One author as itself, several as a list. */
    readonly author?: Contributor | string | readonly (Contributor | string)[];
  }
  export interface TocItem {
    readonly label?: string | null;
    readonly href?: string | null;
    readonly subitems?: readonly TocItem[] | null;
  }
  export interface Section {
    /** The chapter's path in the archive. */
    readonly id: string;
    /** Its place in the package's spine, as a CFI step (`/6/4[ch1]`). */
    readonly cfi: string;
    readonly linear?: string;
    createDocument(): Promise<Document>;
  }
  export interface Loader {
    loadText(name: string): Promise<string | null> | string | null;
    loadBlob(name: string, type?: string): Promise<Blob | null> | Blob | null;
    getSize(name: string): number;
    sha1?: (text: string) => Promise<Uint8Array>;
  }
  export class EPUB {
    constructor(loader: Loader);
    init(): Promise<EPUB>;
    readonly sections: readonly Section[];
    readonly toc?: readonly TocItem[] | null;
    readonly metadata: EpubMetadata;
    resolveHref(href: string): { index: number } | null;
    resolveCFI(cfi: string): { index: number; anchor: (doc: Document) => Range };
    destroy(): void;
  }
}

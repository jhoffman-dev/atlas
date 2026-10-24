/*
 * Whether a part loaded on first use shares a chunk with anything else (#552).
 *
 * A part's chunk (`apps/desktop/src/pages-on-first-use.ts`) recovers from a
 * failed load by being imported again under a fresh address. A chunk it imports
 * statically is not: the browser keeps the failed load of that chunk under its
 * one address, so the part stays broken past Reload. The build makes such a
 * chunk when two parts draw the same code, as Ask and `later-parts` did in
 * PR #547, failing `e2e/on-first-use.attack-271.spec.ts`. So a part's chunk may
 * statically import the entry chunk and nothing else.
 *
 * The rule reads the Vite manifest (`build.manifest`): every dynamic entry is a
 * part, since only the parts are imported lazily, and `later-parts` is one.
 */

/** One chunk of the Vite manifest, keyed there by its source (or `_file` for a shared chunk). */
export type ManifestChunk = {
  file: string;
  name?: string;
  src?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: readonly string[];
};

export type Manifest = Readonly<Record<string, ManifestChunk>>;

/** A static import a part is known to make, by chunk name, that the check lets through. */
export type KnownImport = { part: string; imports: string };

export type SharedChunk = {
  /** The part whose chunk imports the shared one. */
  part: string;
  /** The shared chunk's file. */
  chunk: string;
  /** Every module whose chunk imports the shared chunk statically. */
  importedBy: readonly string[];
};

/**
 * Known before this check: the PDF reader draws `app-pdf-reader`, which adding
 * a PDF also imports lazily, so that chunk is both a part and shared. Listed so
 * the check can land on today's build without changing its chunks; anything
 * else that appears fails.
 */
export const KNOWN_IMPORTS: readonly KnownImport[] = [
  { part: 'document-reader', imports: 'app-pdf-reader' },
];

const nameOf = (key: string, chunk: ManifestChunk | undefined) => chunk?.name ?? chunk?.file ?? key;

function importersOf(manifest: Manifest, key: string): string[] {
  return Object.entries(manifest)
    .filter(([, chunk]) => chunk.imports?.includes(key))
    .map(([importer, chunk]) => chunk.src ?? importer)
    .sort();
}

/** Every static import of a part's chunk that is not the entry chunk, nor a known one. */
export function sharedChunks(
  manifest: Manifest,
  known: readonly KnownImport[] = KNOWN_IMPORTS,
): SharedChunk[] {
  return Object.values(manifest)
    .filter((chunk) => chunk.isDynamicEntry === true)
    .flatMap((part) =>
      (part.imports ?? [])
        .filter((key) => manifest[key]?.isEntry !== true)
        .filter((key) => {
          const imported = nameOf(key, manifest[key]);
          return !known.some((k) => k.part === part.name && k.imports === imported);
        })
        .map((key) => ({
          part: nameOf(part.file, part),
          chunk: manifest[key]?.file ?? key,
          importedBy: importersOf(manifest, key),
        })),
    );
}

/** What the check prints for each shared chunk: the chunk, the part, and who pulled it in. */
export function describeSharedChunk({ part, chunk, importedBy }: SharedChunk): string {
  return [
    `${chunk} is shared under the part '${part}': it imports it statically, so a failed load of '${part}' cannot recover (#552).`,
    `  Pulled in by: ${importedBy.join(', ')}`,
    `  Fix: draw those parts from one chunk (as Ask is drawn from later-parts), or move the shared code into the entry.`,
  ].join('\n');
}

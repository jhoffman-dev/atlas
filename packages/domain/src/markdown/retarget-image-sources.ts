import { relativeImageSource } from '../attachments/image-placement.ts';
import { pathAfterMoves, type EntryMove } from '../vault/vault-moves.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import { imageSourceCandidates } from './image-source.ts';

/** A move (or a batch of them), as the image sources of one note see it. */
export interface ImageSourcesAcrossMove {
  readonly moves: readonly EntryMove[];
  /** Each note the move carried, from its old path to its new one. */
  readonly moved: ReadonlyMap<VaultPath, VaultPath>;
  /** Where the note holding the text is now. */
  readonly path: VaultPath;
}

// `![alt](destination`: the destination in `<…>`, or bare with balanced
// parentheses and backslash escapes, as CommonMark reads one.
const IMAGE =
  /!\[(?:\\.|[^\\\]\n])*\]\([ \t]*(<(?:\\.|[^\\<>\n])*>|(?:\\.|[^\s()\\]|\((?:\\.|[^\s()\\])*\))+)/g;
const EXTERNAL = /^(https?:|data:)/i;

/** Every `![…](src)` in `text` outside code: the source as it names a file, and where its bytes are. */
function imageDestinations(text: string, inCode: (at: number) => boolean) {
  return [...text.matchAll(IMAGE)].flatMap((match) => {
    const written = match[1] ?? '';
    const start = match.index + match[0].length - written.length;
    if (inCode(match.index)) return [];
    const bare = written.startsWith('<') ? written.slice(1, -1) : written;
    const src = bare.replace(/\\([!-/:-@[-`{-~])/g, '$1');
    if (src.trim() === '' || EXTERNAL.test(src.trim())) return [];
    return [{ src, start, end: start + written.length }];
  });
}

/** The note's path before the move. */
function pathBefore({ moved, path }: ImageSourcesAcrossMove): VaultPath {
  for (const [from, to] of moved) if (to === path) return from;
  return path;
}

/** Each place `src` could have meant before the move, with where it is now. */
function placesNow(src: string, across: ImageSourcesAcrossMove) {
  return imageSourceCandidates({ src, notePath: pathBefore(across) }).map((then) => {
    const now = pathAfterMoves(then, across.moves);
    return { now: now ?? then, moved: now !== null };
  });
}

/**
 * Every file the image sources in `text` could name, before the move or after
 * it — what has to be known to exist before `retargetImageSources` can decide.
 */
export function imagePathsAcrossMove({
  text,
  inCode,
  ...across
}: ImageSourcesAcrossMove & { text: string; inCode: (at: number) => boolean }): VaultPath[] {
  return imageDestinations(text, inCode).flatMap(({ src }) => [
    ...placesNow(src, across).map((place) => place.now),
    ...imageSourceCandidates({ src, notePath: across.path }),
  ]);
}

/**
 * Re-points every relative image source a move broke: one in a moved note, or
 * one reaching into a moved folder. The image is found where it was before the
 * move — beside the note, else from the vault root — and followed to where it
 * is now. When the note or the image moved, and the source read from the
 * note's folder no longer names it, the source is rewritten relative to the
 * note: the form every markdown tool reads, not only one that falls back to
 * the vault root. Just the destination's bytes change. An image found in
 * neither place is left alone: rewriting it would be a guess.
 */
export function retargetImageSources({
  text,
  exists,
  inCode,
  ...across
}: ImageSourcesAcrossMove & {
  text: string;
  exists: (path: VaultPath) => boolean;
  inCode: (at: number) => boolean;
}): { text: string; count: number } {
  const noteMoved = pathBefore(across) !== across.path;
  let count = 0;
  let rewritten = '';
  let cursor = 0;
  for (const { src, start, end } of imageDestinations(text, inCode)) {
    const image = placesNow(src, across).find((place) => exists(place.now));
    if (image === undefined || !(noteMoved || image.moved)) continue;
    if (imageSourceCandidates({ src, notePath: across.path })[0] === image.now) continue;
    const anchor = src.includes('#') ? src.slice(src.indexOf('#')) : '';
    const written = relativeImageSource({ notePath: across.path, imagePath: image.now });
    rewritten += text.slice(cursor, start) + written + anchor;
    cursor = end;
    count += 1;
  }
  return { text: rewritten + text.slice(cursor), count };
}

import { pathAfterMoves, type EntryMove } from '../vault/vault-moves.ts';
import { noteTitle } from '../vault/vault-entry.ts';
import { parentVaultPath, VAULT_ROOT, type VaultPath } from '../vault/vault-path.ts';
import { resolveWikiLinkTarget } from './resolve-wikilink.ts';
import { imagePathsAcrossMove, retargetImageSources } from './retarget-image-sources.ts';
import { wikiLinkSpans } from './wikilink-spans.ts';

/** The vault's notes either side of a move (or a batch of them), and where each moved note went. */
export interface NotesAcrossMove {
  /** The moves, in the order they were made: one, or a batch's. */
  readonly moves: readonly EntryMove[];
  readonly before: readonly VaultPath[];
  readonly after: readonly VaultPath[];
  /** Each note the move carried, from its old path to its new one. */
  readonly moved: ReadonlyMap<VaultPath, VaultPath>;
}

/** The notes before and after `move`: a folder's move carries every note under it. */
export function notesAfterMove(move: EntryMove, notes: readonly VaultPath[]): NotesAcrossMove {
  return notesAfterMoves([move], notes);
}

/**
 * The notes before and after a batch of moves made one after another — a
 * batch archived together — so their links can be re-pointed in one pass.
 */
export function notesAfterMoves(
  moves: readonly EntryMove[],
  notes: readonly VaultPath[],
): NotesAcrossMove {
  const moved = new Map<VaultPath, VaultPath>();
  const after = notes.map((path) => {
    const to = pathAfterMoves(path, moves);
    if (to === null) return path;
    moved.set(path, to);
    return to;
  });
  return { moves, before: notes, after, moved };
}

// A fenced block, from its opening fence to the matching close (or the end),
// and an inline code span: an image source inside either is text. (Wiki links
// are found by `wikiLinkSpans`, which reads code as the editor does.)
const CODE =
  /^( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\2[`~]*[ \t]*$|(?![\s\S]))|(`+)[^`\n][\s\S]*?\3/gm;

/** What a note's text needs besides the move to have its links re-pointed. */
export interface NoteAcrossMove {
  readonly text: string;
  /** Where the note holding `text` is now. */
  readonly path: VaultPath;
  /** Whether a file is in the vault, after the move: how an image source is followed. */
  readonly exists: (path: VaultPath) => boolean;
}

/**
 * Re-points every link the move broke, so it opens what it opened before.
 *
 * A wiki link that opened a note the move carried: a rename changes the name
 * the link finds it by, a move changes a link written as a path, and a move
 * can leave a bare name opening another note of the same name. Only a link's
 * target is rewritten — its heading, alias and `!` stay byte for byte, as does
 * everything else. A link that still opens the note is untouched.
 *
 * An image source written relative to the note, which a move of the note — or
 * of the folder the image is in — leaves pointing at nothing: see
 * `retargetImageSources`. A link or image in code is left alone.
 */
export function retargetLinks({
  text,
  path,
  exists,
  ...across
}: NotesAcrossMove & NoteAcrossMove): { text: string; count: number } {
  const links = retargetWikiLinks({ text, ...across });
  const images = retargetImageSources({
    text: links.text,
    path,
    exists,
    moves: across.moves,
    moved: across.moved,
    inCode: codeRanges(links.text),
  });
  return { text: images.text, count: links.count + images.count };
}

/** Every file the image sources in a note's text could name, across the move. */
export function imagePathsToCheck({
  text,
  path,
  moves,
  moved,
}: Pick<NotesAcrossMove, 'moves' | 'moved'> & Pick<NoteAcrossMove, 'text' | 'path'>): VaultPath[] {
  return imagePathsAcrossMove({ text, path, moves, moved, inCode: codeRanges(text) });
}

/** Whether an offset in `text` falls in a fenced block or a code span. */
function codeRanges(text: string): (at: number) => boolean {
  const code = [...text.matchAll(CODE)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
  return (at) => code.some((range) => at >= range.start && at < range.end);
}

/**
 * Rewrites the target of each link the editor reads (`wikiLinkSpans`) that the
 * move broke. Only the target's bytes change: the `!`, heading and alias,
 * `\|` and all, stay as written.
 */
function retargetWikiLinks({ text, before, after, moved }: NotesAcrossMove & { text: string }): {
  text: string;
  count: number;
} {
  let count = 0;
  let cursor = 0;
  const pieces: string[] = [];
  for (const { targetStart, targetEnd, link } of wikiLinkSpans(text)) {
    const opened = resolveWikiLinkTarget(link.target, before);
    const to = opened === null ? undefined : moved.get(opened);
    if (to === undefined || resolveWikiLinkTarget(link.target, after) === to) continue;
    count += 1;
    pieces.push(text.slice(cursor, targetStart), targetFor({ written: link.target, to, after }));
    cursor = targetEnd;
  }
  if (count === 0) return { text, count };
  pieces.push(text.slice(cursor));
  return { text: pieces.join(''), count };
}

/**
 * The target that opens `to` among `after`: its name when the link was a name
 * and the name alone finds it, else its path — without `.md`, unless the
 * link was written with one.
 */
function targetFor({
  written,
  to,
  after,
}: {
  written: string;
  to: VaultPath;
  after: readonly VaultPath[];
}): string {
  const extension = /\.md$/i.test(written.trim()) ? '.md' : '';
  const name = `${noteTitle(to)}${extension}`;
  if (!written.includes('/') && resolveWikiLinkTarget(name, after) === to) return name;
  const folder = parentVaultPath(to);
  return folder === VAULT_ROOT ? name : `${folder}/${name}`;
}

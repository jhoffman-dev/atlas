import {
  createVaultPath,
  noteTitle,
  parentVaultPath,
  previewLines,
  vaultPathName,
  type ObjectType,
} from '@dfai/domain';
import { noteTypeName } from '../types/load-types.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import type { MarkdownPort } from './ports.ts';
import { readNotePreviews } from './read-note-previews.ts';

/** What a link's preview card says of the note it points at. */
export interface LinkPreviewRead {
  readonly title: string;
  /** Its type and folder, "Task · Tasks"; null when it has neither. */
  readonly kicker: string | null;
  /** Its first lines; null when it has no words. */
  readonly excerpt: string | null;
}

/**
 * Reads what a link's preview card shows (slice 6b): the note's title, the
 * type it is and the folder it is in, and its first lines — from the file,
 * through the read a feed's bodies take, one note at a time. Null for a
 * note the host cannot read: the card is simply not shown.
 */
export async function readLinkPreview({
  fs,
  markdown,
  types,
  path,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  types: readonly ObjectType[];
  path: string;
}): Promise<LinkPreviewRead | null> {
  const [preview] = await readNotePreviews({ fs, markdown, paths: [path] });
  if (preview === undefined) return null;
  const { properties } = preview;
  const named = properties['title'];
  const title =
    typeof named === 'string' && named.trim() !== ''
      ? named.trim()
      : noteTitle(createVaultPath(path));
  const typeName = noteTypeName(properties);
  const type = types.find((candidate) => candidate.name === typeName)?.label ?? null;
  // The root's name is empty, so a note at the top of the vault names no folder.
  const folder = vaultPathName(parentVaultPath(createVaultPath(path)));
  const kicker = [type, folder].filter((part) => part !== null && part !== '').join(' · ');
  return {
    title,
    kicker: kicker === '' ? null : kicker,
    excerpt: previewLines(preview.doc, title),
  };
}

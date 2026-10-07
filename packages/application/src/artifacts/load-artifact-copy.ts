import {
  ARTIFACT_ENTRY,
  artifactMediaType,
  createVaultPath,
  dataUrl,
  inlineArtifactPage,
  isAtlasNote,
  isArtifactPage,
  isVisibleEntry,
  joinVaultPath,
  MAX_ARTIFACT_FILES,
  pageReferences,
  savedFolderOf,
  stylesheetReferences,
  vaultPathName,
  type InlineFile,
  type VaultPath,
} from '@atlas/domain';
import { VaultAccessError, type VaultFsPort } from '../vault/ports.ts';

/** An artifact's saved copy, as the viewer shows it. */
export type ArtifactCopy =
  /** The note keeps only the link. */
  | { readonly kind: 'none' }
  /** The note names a copy that is not there, or has no page in it. */
  | { readonly kind: 'missing'; readonly folder: string }
  | {
      readonly kind: 'ready';
      readonly folder: VaultPath;
      /** One document, every file it names written into it, for a frame's `srcdoc`. */
      readonly page: string;
    };

/** How deep the copy is searched for files; the deepest a copy may hold. */
const MAX_DEPTH = 4;

/** How much is written into the page before the rest is left out. */
const INLINE_BUDGET_BYTES = 48 * 1024 * 1024;

/**
 * The saved copy a note names, made into one document a sandboxed frame can
 * show (`inlineArtifactPage`).
 *
 * Only what the page names is read: its stylesheets, scripts and pictures,
 * and the fonts and pictures its stylesheets name. A copy that is gone, or
 * outside the vault's own space, is `missing` — shown as such, never an error.
 */
export async function loadArtifactCopy({
  fs,
  properties,
}: {
  fs: VaultFsPort;
  properties: Readonly<Record<string, unknown>>;
}): Promise<ArtifactCopy> {
  const named = savedFolderOf(properties);
  if (named === null) return { kind: 'none' };
  const folder = copyFolder(named);
  if (folder === null) return { kind: 'missing', folder: named };

  try {
    const names = await listArtifactCopy(fs, folder);
    const entry = names.includes(ARTIFACT_ENTRY) ? ARTIFACT_ENTRY : names.find(isArtifactPage);
    if (entry === undefined) return { kind: 'missing', folder };
    const html = (await fs.readTextFile(joinVaultPath(folder, entry))).text;
    const files = await readReferenced({ fs, folder, html, entry, held: new Set(names) });
    return { kind: 'ready', folder, page: inlineArtifactPage({ html, from: entry, files }) };
  } catch (error) {
    if (error instanceof VaultAccessError) return { kind: 'missing', folder };
    throw error;
  }
}

/** The folder, when it is a path in the vault's own space; `.atlas` and hidden folders are not. */
function copyFolder(named: string): VaultPath | null {
  try {
    const path = createVaultPath(named);
    const visible = isVisibleEntry({ kind: 'directory', name: vaultPathName(path), path });
    return visible && !isAtlasNote(path) ? path : null;
  } catch {
    // Not a vault path at all: the note names nothing that could be shown.
    return null;
  }
}

/** Every file in the copy, relative to it, a level at a time, stopping once past the file limit. */
export async function listArtifactCopy(fs: VaultFsPort, folder: VaultPath): Promise<string[]> {
  const found: string[] = [];
  let level: VaultPath[] = [folder];
  for (let depth = 0; depth < MAX_DEPTH && level.length > 0; depth += 1) {
    const entries = (await Promise.all(level.map((path) => fs.listDirectory(path)))).flat();
    const visible = entries.filter((entry) => isVisibleEntry(entry));
    for (const entry of visible) {
      if (entry.kind === 'file') found.push(entry.path.slice(folder.length + 1));
    }
    level = visible.filter((entry) => entry.kind === 'directory').map((entry) => entry.path);
    if (found.length > MAX_ARTIFACT_FILES) break;
  }
  return found;
}

/** What the page and its stylesheets name that the copy holds, read and ready to write in. */
async function readReferenced({
  fs,
  folder,
  html,
  entry,
  held,
}: {
  fs: VaultFsPort;
  folder: VaultPath;
  html: string;
  entry: string;
  held: ReadonlySet<string>;
}): Promise<Map<string, InlineFile>> {
  const files = new Map<string, InlineFile>();
  const budget = { left: INLINE_BUDGET_BYTES };
  const wanted = pageReferences(html, entry).filter((path) => held.has(path));
  for (const path of wanted) {
    const file = await readInline({ fs, folder, path, budget });
    if (file === null) continue;
    files.set(path, file);
    if ('text' in file && path.toLowerCase().endsWith('.css')) {
      for (const inner of stylesheetReferences(file.text, path)) {
        if (!held.has(inner) || files.has(inner)) continue;
        const read = await readInline({ fs, folder, path: inner, budget });
        if (read !== null) files.set(inner, read);
      }
    }
  }
  return files;
}

/**
 * One file, as the page takes it: a stylesheet or a script as text, anything
 * else as a `data:` URL. Null once the budget is spent, or when the file will
 * not read — the page then shows without it, as it would with a broken link.
 */
async function readInline({
  fs,
  folder,
  path,
  budget,
}: {
  fs: VaultFsPort;
  folder: VaultPath;
  path: string;
  budget: { left: number };
}): Promise<InlineFile | null> {
  const where = joinVaultPath(folder, path);
  try {
    if (/\.(css|js)$/i.test(path)) {
      const { text } = await fs.readTextFile(where);
      budget.left -= text.length;
      return budget.left < 0 ? null : { text };
    }
    const bytes = new Uint8Array(await fs.readBinaryFile(where));
    budget.left -= bytes.byteLength;
    return budget.left < 0 ? null : { dataUrl: dataUrl(artifactMediaType(path), bytes) };
  } catch (error) {
    if (error instanceof VaultAccessError) return null;
    throw error;
  }
}

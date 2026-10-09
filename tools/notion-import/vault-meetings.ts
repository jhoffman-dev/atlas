import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { splitFrontmatter } from '../../packages/domain/src/index.ts';
import { remarkMarkdown } from '../../packages/adapters/src/index.ts';

/** A meeting's identity under the contract: provider and trimmed external_id (ADR-0027). */
export const meetingKey = (provider: string, externalId: string) =>
  `${provider}\n${externalId.trim()}`;

/** Every markdown file under `folder`, hidden files and folders left out as everywhere in Atlas (ADR-0014). */
async function markdownFiles(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const path = join(folder, entry.name);
    if (entry.isDirectory()) found.push(...(await markdownFiles(path)));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) found.push(path);
  }
  return found;
}

/** The meeting key a note's frontmatter names, or null when it names none. */
function heldKey(text: string): string | null {
  const properties = remarkMarkdown.frontmatterProperties(splitFrontmatter(text).frontmatter);
  const { provider, external_id: externalId } = properties;
  if (typeof provider !== 'string' || typeof externalId !== 'string') return null;
  return meetingKey(provider, externalId);
}

/**
 * Where in the vault each meeting already is, by its key: wherever it was
 * moved, renamed or archived, and whatever the import stamped it. Paths are
 * vault-relative with `/`. A note whose frontmatter does not read names no
 * meeting, as it does for the import (P28-04).
 */
export async function meetingsInVault(vault: string): Promise<Map<string, string>> {
  const held = new Map<string, string>();
  for (const path of await markdownFiles(vault)) {
    const text = await readFile(path, 'utf8');
    if (!text.includes('external_id')) continue;
    const key = heldKey(text);
    if (key !== null && !held.has(key)) held.set(key, relative(vault, path).split(sep).join('/'));
  }
  return held;
}

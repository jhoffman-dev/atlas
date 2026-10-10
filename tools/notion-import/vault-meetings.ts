import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import {
  isConflictCopyPath,
  meetingHolding,
  splitFrontmatter,
  type FrontmatterReading,
  type MeetingIdentity,
} from '../../packages/domain/src/index.ts';
import { remarkMarkdown } from '../../packages/adapters/src/index.ts';

/** A meeting's identity as a key: provider and trimmed external_id (ADR-0027). */
export const meetingKey = ({ provider, externalId }: MeetingIdentity) =>
  `${provider}\n${externalId.trim()}`;

/** A frontmatter block read with the YAML reader Atlas reads every note with; no values when it does not read. */
export function readFrontmatter(frontmatter: string): FrontmatterReading {
  const problem = remarkMarkdown.frontmatterProblem(frontmatter);
  return {
    properties: problem === null ? remarkMarkdown.frontmatterProperties(frontmatter) : {},
    problem,
  };
}

/** Whether the text holds the meeting by the import's rule (P28-04): a stamped or a valid, unstamped copy of it. */
export const holdsMeeting = (text: string, meeting: MeetingIdentity): boolean =>
  meetingHolding({ text, readFrontmatter, meeting }) !== null;

/** Every markdown file under `folder`, hidden files and folders left out as everywhere in Atlas (ADR-0014). */
export async function markdownFiles(folder: string): Promise<string[]> {
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

/** The meeting a note's own keys name, or null when they name none. */
function namedMeeting(text: string): MeetingIdentity | null {
  const frontmatter = splitFrontmatter(text).frontmatter;
  if (frontmatter === null) return null;
  const { provider, external_id: externalId } = readFrontmatter(frontmatter).properties;
  if (typeof provider !== 'string' || typeof externalId !== 'string') return null;
  return { provider, externalId };
}

/**
 * Where in the vault each meeting already is, by its key: the notes that
 * hold it by the import's own rule (P28-04, `meetingHolding`), wherever they
 * were moved, renamed or archived. A sync conflict's copy, a note stamped
 * `duplicate` or `error`, and an unstamped note that breaks the contract hold
 * nothing, so the import is not stopped by them. Paths are vault-relative
 * with `/`.
 */
export async function meetingsInVault(vault: string): Promise<Map<string, string>> {
  const held = new Map<string, string>();
  for (const path of await markdownFiles(vault)) {
    const shown = relative(vault, path).split(sep).join('/');
    if (isConflictCopyPath(shown)) continue;
    const text = await readFile(path, 'utf8');
    const meeting = text.includes('external_id') ? namedMeeting(text) : null;
    if (meeting === null || !holdsMeeting(text, meeting)) continue;
    if (!held.has(meetingKey(meeting))) held.set(meetingKey(meeting), shown);
  }
  return held;
}

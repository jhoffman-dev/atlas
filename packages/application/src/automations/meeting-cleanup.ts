import {
  answeredMeetingOf,
  compileMadeItemsQuery,
  createVaultPath,
  meetingTasksFailingRules,
  noteTitle,
  readWikiLink,
  resolveWikiLinkTarget,
  splitFrontmatter,
  type CitedMeeting,
  type CleanupCandidate,
  type MadeMeetingTask,
  type VaultPath,
} from '@atlas/domain';
import { archiveNotes, type ArchiveOutcome, type ArchivePorts } from '../archive/archive-notes.ts';
import type { IndexPort } from '../index/ports.ts';
import { loadLinkDirectory } from '../meeting-links/link-directory.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { listVaultNotes } from '../vault/read-vault.ts';

/** What the cleanup reads: the index to find the made tasks and the people, the files to judge them. */
export interface MeetingCleanupPorts {
  readonly index: Pick<IndexPort, 'query'>;
  readonly fs: VaultFsPort;
  readonly markdown: Pick<MarkdownPort, 'frontmatterProperties'>;
}

/** The vault's owner as Settings → Profile holds them, read by the caller as the step reads them. */
export interface CleanupOwner {
  readonly selfName: string | null;
  readonly selfEmails: readonly string[];
}

/**
 * The tasks the "After a meeting" rule made that today's rules would not
 * have made (#226), for the person to look over: found by their
 * `atlas_item`, and judged by `meetingTasksFailingRules` against the meeting
 * each cites as it is now. Reads only.
 */
export async function previewMeetingCleanup({
  ports,
  owner,
}: {
  ports: MeetingCleanupPorts;
  owner: CleanupOwner;
}): Promise<CleanupCandidate[]> {
  const made = await madeTaskPaths(ports.index);
  if (made.length === 0) return [];
  const notePaths = await listVaultNotes({ fs: ports.fs });
  const tasks = (await ports.fs.readNotes(made)).map((file): MadeMeetingTask => {
    const path = createVaultPath(file.path);
    return { path, title: noteTitle(path), properties: propertiesOf(ports.markdown, file.text) };
  });
  const meetings = await citedMeetings({ ports, tasks, notePaths });
  const { people } = await loadLinkDirectory({ index: ports.index });
  return meetingTasksFailingRules({
    tasks,
    meetingOf: (target) => {
      const path = resolveWikiLinkTarget(target, notePaths);
      return path === null ? null : (meetings.get(path) ?? null);
    },
    owner: { ...owner, people },
  });
}

/**
 * Archives the tasks the preview `shown` listed, less those the person kept,
 * once they said so — never deletes. The preview is read again first, and a
 * task is archived only when it is still listed: one edited, finished or
 * moved since stays where it is.
 */
export async function applyMeetingCleanup({
  ports,
  owner,
  shown,
  kept,
  today,
}: {
  ports: MeetingCleanupPorts & ArchivePorts;
  owner: CleanupOwner;
  shown: readonly CleanupCandidate[];
  /** The tasks the person chose to keep. */
  kept: readonly VaultPath[];
  /** `YYYY-MM-DD`, from the injected clock. */
  today: string;
}): Promise<ArchiveOutcome> {
  const now = await previewMeetingCleanup({ ports, owner });
  const asShown = new Set(shown.map(({ path }) => path));
  const keep = new Set<string>(kept);
  const paths = now.map(({ path }) => path).filter((path) => asShown.has(path) && !keep.has(path));
  if (paths.length === 0) return { moves: [], failed: [], linksUpdated: 0 };
  const notePaths = await listVaultNotes({ fs: ports.fs });
  return archiveNotes({ ports, paths, notePaths, today });
}

/** Every note the index holds an `atlas_item` for, outside the Archive's reach or not: the domain says which count. */
async function madeTaskPaths(index: Pick<IndexPort, 'query'>): Promise<string[]> {
  const { sql, parameters } = compileMadeItemsQuery();
  const result = await index.query(sql, parameters);
  const at = result.columns.indexOf('path');
  const paths = result.rows.flatMap((row) => (typeof row[at] === 'string' ? [row[at]] : []));
  return [...new Set(paths)];
}

/** The meetings the tasks cite, read once each, by path. */
async function citedMeetings({
  ports,
  tasks,
  notePaths,
}: {
  ports: MeetingCleanupPorts;
  tasks: readonly MadeMeetingTask[];
  notePaths: readonly VaultPath[];
}): Promise<Map<string, CitedMeeting>> {
  const paths = new Set<VaultPath>();
  for (const { properties } of tasks) {
    const source = properties['source'];
    const link = typeof source === 'string' ? readWikiLink(source.trim()) : null;
    const path = link === null ? null : resolveWikiLinkTarget(link.target, notePaths);
    if (path !== null) paths.add(path);
  }
  const files = paths.size === 0 ? [] : await ports.fs.readNotes([...paths]);
  return new Map(
    files.map((file) => {
      const meeting = answeredMeetingOf(propertiesOf(ports.markdown, file.text));
      return [file.path, { text: file.text, attendees: meeting?.attendees ?? [] }];
    }),
  );
}

function propertiesOf(
  markdown: Pick<MarkdownPort, 'frontmatterProperties'>,
  text: string,
): Readonly<Record<string, unknown>> {
  return markdown.frontmatterProperties(splitFrontmatter(text).frontmatter);
}

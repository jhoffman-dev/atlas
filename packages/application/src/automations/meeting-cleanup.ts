import {
  answeredMeetingOf,
  compileMadeItemsQuery,
  createVaultPath,
  digestOf,
  MEETING_ITEM_KEPT_KEY,
  meetingTasksFailingRules,
  noteTitle,
  readWikiLink,
  resolveWikiLinkTarget,
  splitFrontmatter,
  vaultNamesItsOwner,
  type CitedMeeting,
  type CleanupCandidate,
  type MadeMeetingTask,
  type VaultPath,
} from '@dfai/domain';
import {
  archiveNotes,
  type ArchiveFailure,
  type ArchiveOutcome,
  type ArchivePorts,
} from '../archive/archive-notes.ts';
import type { IndexPort } from '../index/ports.ts';
import { loadLinkDirectory } from '../meeting-links/link-directory.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { writeFrontmatterChanges } from '../query/set-property.ts';
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

/** A task the preview listed, with the digest of the file as it was read: what Archive is checked against. */
export interface ListedCleanupTask extends CleanupCandidate {
  readonly digest: string;
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
}): Promise<ListedCleanupTask[]> {
  const made = await madeTaskPaths(ports.index);
  if (made.length === 0) return [];
  const notePaths = await listVaultNotes({ fs: ports.fs });
  const files = await ports.fs.readNotes(made);
  const digests = new Map(files.map((file) => [file.path, digestOf(file.text)]));
  const tasks = files.map((file): MadeMeetingTask => {
    const path = createVaultPath(file.path);
    return { path, title: noteTitle(path), properties: propertiesOf(ports.markdown, file.text) };
  });
  const meetings = await citedMeetings({ ports, tasks, notePaths });
  const { people } = await loadLinkDirectory({ index: ports.index });
  const listed = meetingTasksFailingRules({
    tasks,
    meetingOf: (target) => {
      const path = resolveWikiLinkTarget(target, notePaths);
      return path === null ? null : (meetings.get(path) ?? null);
    },
    owner: { ...owner, people },
  });
  return listed.map((task) => ({ ...task, digest: digests.get(task.path) ?? '' }));
}

/**
 * Whether the cleanup cannot judge the tasks meetings made, and so lists
 * none: the rule made some, and the vault does not say who its owner is —
 * by a profile name, or addresses (its `selfEmails`, else the owner's
 * Person note's). The preview then says why instead (#226). Reads only.
 */
export async function meetingCleanupNeedsOwner({
  ports,
  owner,
}: {
  ports: Pick<MeetingCleanupPorts, 'index'>;
  owner: CleanupOwner;
}): Promise<boolean> {
  const { people } = await loadLinkDirectory({ index: ports.index });
  if (vaultNamesItsOwner({ ...owner, people })) return false;
  return (await madeTaskPaths(ports.index)).length > 0;
}

/**
 * Archives the tasks the preview `shown` listed, less those the person kept,
 * once they said so — never deletes — and marks the ones they kept, so they
 * are never listed again ({@link keepMeetingCleanupTasks}). The preview is
 * read again first, and a task is archived only when it is still listed and
 * unchanged: one edited (on disk, or with typing not yet saved), finished or
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
  shown: readonly ListedCleanupTask[];
  /** The tasks the person chose to keep. */
  kept: readonly VaultPath[];
  /** `YYYY-MM-DD`, from the injected clock. */
  today: string;
}): Promise<ArchiveOutcome> {
  const keep = new Set<string>(kept);
  const kepts = shown.filter(({ path }) => keep.has(path)).map(({ path }) => path);
  const now = await previewMeetingCleanup({ ports, owner });
  const asShown = new Map(shown.map(({ path, digest }) => [path, digest]));
  const paths = now
    .filter(({ path, digest }) => !keep.has(path) && asShown.get(path) === digest)
    .map(({ path }) => path)
    .filter((path) => ports.editors.state(path) !== 'dirty');
  const archived =
    paths.length === 0
      ? { moves: [], failed: [], linksUpdated: 0 }
      : await archiveNotes({
          ports,
          paths,
          notePaths: await listVaultNotes({ fs: ports.fs }),
          today,
        });
  const unmarked = await keepMeetingCleanupTasks({ ports, paths: kepts });
  return { ...archived, failed: [...archived.failed, ...unmarked] };
}

/**
 * Marks the tasks the person chose to keep when the cleanup listed them
 * (`atlas_item_kept: true`), so no later preview lists them, nor ticks them,
 * again (#226). Any typing not yet saved is saved first. Returns the ones that
 * could not be marked, and why.
 */
export async function keepMeetingCleanupTasks({
  ports,
  paths,
}: {
  ports: Pick<ArchivePorts, 'fs' | 'markdown' | 'editors'>;
  paths: readonly VaultPath[];
}): Promise<ArchiveFailure[]> {
  const failed: ArchiveFailure[] = [];
  for (const path of paths) {
    try {
      if (ports.editors.state(path) === 'dirty') await ports.editors.flush([path]);
      await writeFrontmatterChanges({
        fs: ports.fs,
        markdown: ports.markdown,
        path,
        values: { [MEETING_ITEM_KEPT_KEY]: true },
      });
      if (ports.editors.state(path) !== 'dirty') ports.editors.reload(path);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      failed.push({ path, reason: `it could not be marked as kept: ${reason}` });
    }
  }
  return failed;
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

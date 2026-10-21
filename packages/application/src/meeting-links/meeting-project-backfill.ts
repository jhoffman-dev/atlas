import {
  isOwnerKnown,
  linkedNotes,
  MEETING_PROJECT_KEY,
  participantOwnerOf,
  planProjectBackfill,
  splitFrontmatter,
  wikiLinkTargetFor,
  type DoneAction,
  type PassedOver,
  type PriorValue,
  type ProjectBackfillRow,
  type VaultPath,
} from '@dfai/domain';
import { changeProperties, type PropertyChange } from '../automations/apply-changes.ts';
import { listVaultNotes } from '../vault/read-vault.ts';
import { loadLinkDirectory } from './link-directory.ts';
import type { MeetingLinkPorts } from './link-meeting.ts';
import { loadBackfillMeetings } from './meeting-series-source.ts';

/** The vault's owner, as the series rule leaves them out of who was at a meeting. */
export interface BackfillOwner {
  readonly selfName: string | null;
  readonly selfEmails: readonly string[];
}

/** What filing meetings under their projects did: each `project` set, and each meeting left and why. */
export interface ProjectBackfillRun {
  readonly done: readonly DoneAction[];
  readonly left: readonly PassedOver[];
}

/** Why a meeting was left: something was set in its `project` since the preview. */
export const FILED_SINCE = 'Its project was set since the preview, so it was left as it is.';

/**
 * Every meeting outside the Archive with nothing in its `project`, and what
 * its twin or series says it is filed under (#227), read from the index:
 * what the backfill offers, before anything is written.
 */
export async function previewProjectBackfill({
  ports,
  owner,
}: {
  ports: Pick<MeetingLinkPorts, 'index'>;
  owner: BackfillOwner;
}): Promise<ProjectBackfillRow[]> {
  const { people } = await loadLinkDirectory({ index: ports.index });
  const participantOwner = participantOwnerOf({ people, ...owner });
  const meetings = await loadBackfillMeetings({ index: ports.index, owner: participantOwner });
  return planProjectBackfill({ meetings, ownerKnown: isOwnerKnown(participantOwner) });
}

/**
 * Files each chosen meeting under the project its row suggests (#227),
 * writing its `project` and nothing else, as one run that
 * {@link undoProjectBackfill} takes back. A meeting whose `project` holds
 * anything now — set by hand, or by an earlier run — is left and said, so
 * running it twice files nothing twice; as is one with unsaved typing, or
 * changed between the read and the write.
 */
export async function applyProjectBackfill({
  ports,
  rows,
  today,
}: {
  ports: MeetingLinkPorts;
  rows: readonly ProjectBackfillRow[];
  today: string;
}): Promise<ProjectBackfillRun> {
  const filing = rows.filter((row) => row.suggestion !== null);
  if (filing.length === 0) return { done: [], left: [] };
  const notePaths = await listVaultNotes({ fs: ports.fs });
  const files = await ports.fs.readNotes(filing.map((row) => row.meeting));
  const held = new Map(files.map((file) => [file.path, propertiesOf(ports, file.text)]));
  const left: PassedOver[] = [];
  const changes: PropertyChange[] = [];
  for (const row of filing) {
    const properties = held.get(row.meeting) ?? {};
    if (linkedNotes(properties[MEETING_PROJECT_KEY]).length > 0) {
      left.push({ path: row.meeting, reason: FILED_SINCE });
      continue;
    }
    changes.push(filingChange({ row, properties, notePaths }));
  }
  const outcome = await changeProperties({ ports, changes, kind: 'set', today });
  return { done: outcome.done, left: [...left, ...outcome.left] };
}

/**
 * Takes a backfill back: each `project` it set goes back to what it held —
 * unless it has changed since, which is left and said. Only `project` is
 * ever put back, whatever the run says it did.
 */
export async function undoProjectBackfill({
  ports,
  run,
  today,
}: {
  ports: MeetingLinkPorts;
  run: ProjectBackfillRun;
  today: string;
}): Promise<ProjectBackfillRun> {
  const changes = run.done.flatMap((line): PropertyChange[] =>
    line.kind === 'set' && line.key === MEETING_PROJECT_KEY
      ? [{ path: line.path, key: line.key, expect: line.after, to: line.before }]
      : [],
  );
  const outcome = await changeProperties({ ports, changes, kind: 'restored', today });
  return { done: outcome.done, left: outcome.left };
}

function filingChange({
  row,
  properties,
  notePaths,
}: {
  row: ProjectBackfillRow;
  properties: Readonly<Record<string, unknown>>;
  notePaths: readonly VaultPath[];
}): PropertyChange {
  const project = row.suggestion!.project;
  return {
    path: row.meeting,
    key: MEETING_PROJECT_KEY,
    expect: priorOf(properties),
    to: { value: `[[${wikiLinkTargetFor(project, notePaths)}]]` },
  };
}

function priorOf(properties: Readonly<Record<string, unknown>>): PriorValue {
  return Object.hasOwn(properties, MEETING_PROJECT_KEY)
    ? { value: properties[MEETING_PROJECT_KEY] }
    : { absent: true };
}

function propertiesOf(
  ports: Pick<MeetingLinkPorts, 'markdown'>,
  text: string,
): Readonly<Record<string, unknown>> {
  return ports.markdown.frontmatterProperties(splitFrontmatter(text).frontmatter);
}

import {
  attendeesOf,
  compileSeriesMeetingsQuery,
  compileSeriesParticipantsQuery,
  isArchivedPath,
  MEETING_SERIES_PAGE_SIZE,
  meetingParticipants,
  meetingsOnRecord,
  noteTitle,
  seriesNeighbours,
  suggestMeetingProject,
  type MeetingOnRecord,
  type ParticipantOwner,
  type ProjectSuggestion,
  type SeriesMeetingRow,
  type SeriesParticipantRow,
  type VaultPath,
} from '@atlas/domain';
import type { IndexPort, QueryResult } from '../index/ports.ts';

type Index = Pick<IndexPort, 'query'>;

/** Meetings whose participants one statement asks for: a bounded list of bound paths. */
const PARTICIPANT_PATHS_PER_ASK = 200;

/**
 * The meetings the index holds that a series rule over `targets` can read
 * anything from — those sharing a title or a day with one of them — with who
 * was at each (#227). Read from the index a page at a time, never from the
 * files, however many meetings the vault holds.
 */
export async function loadSeriesNeighbours({
  index,
  owner,
  targets,
}: {
  index: Index;
  owner: ParticipantOwner;
  targets: readonly Pick<SeriesMeetingRow, 'title' | 'date'>[];
}): Promise<MeetingOnRecord[]> {
  const rows = seriesNeighbours(await readSeriesMeetings(index), targets);
  const participants = await readParticipants(
    index,
    rows.map((row) => row.path),
  );
  return meetingsOnRecord({ meetings: rows, participants, owner });
}

/**
 * The meetings outside the Archive whose `project` holds nothing, and every
 * meeting of their series or day: what a backfill reads (#227).
 */
export async function loadBackfillMeetings({
  index,
  owner,
}: {
  index: Index;
  owner: ParticipantOwner;
}): Promise<MeetingOnRecord[]> {
  const all = await readSeriesMeetings(index);
  const unfiled = all.filter((row) => !row.filed && !isArchivedPath(row.path));
  if (unfiled.length === 0) return [];
  const rows = seriesNeighbours(all, unfiled);
  const participants = await readParticipants(
    index,
    rows.map((row) => row.path),
  );
  return meetingsOnRecord({ meetings: rows, participants, owner });
}

/**
 * What the meeting at `path`, as its frontmatter is now, is likely filed
 * under (#227): its twin or its series in the index, read for its title and
 * day alone. Null for a meeting with no day, or when nothing says.
 */
export async function seriesProjectFor({
  index,
  path,
  properties,
  people,
  owner,
}: {
  index: Index;
  path: VaultPath;
  properties: Readonly<Record<string, unknown>>;
  /** The Person notes it is linked to, or is about to be. */
  people: readonly VaultPath[];
  owner: ParticipantOwner;
}): Promise<ProjectSuggestion | null> {
  const date = textOf(properties['date']).slice(0, 10);
  if (date === '') return null;
  const title = textOf(properties['title']) || noteTitle(path);
  const others = await loadSeriesNeighbours({ index, owner, targets: [{ title, date }] });
  const meeting = {
    path,
    title,
    date,
    start: textOf(properties['start']) || null,
    provider: textOf(properties['provider']),
    participants: meetingParticipants({ attendees: attendeesOf(properties), people, owner }),
    project: null,
  };
  return suggestMeetingProject({ meeting, others });
}

async function readSeriesMeetings(index: Index): Promise<SeriesMeetingRow[]> {
  const rows: SeriesMeetingRow[] = [];
  for (let page = 0; ; page += 1) {
    const { sql, parameters } = compileSeriesMeetingsQuery(page);
    const result = await index.query(sql, parameters);
    const cell = cellsOf(result);
    rows.push(
      ...result.rows.map((row) => ({
        path: String(cell(row, 'path')),
        title: String(cell(row, 'title') ?? ''),
        date: textOrNull(cell(row, 'date')),
        start: textOrNull(cell(row, 'start')),
        provider: textOrNull(cell(row, 'provider')),
        filed: Number(cell(row, 'filed')) === 1,
        project: textOrNull(cell(row, 'project')),
        projectTitle: textOrNull(cell(row, 'project_title')),
        projectType: textOrNull(cell(row, 'project_type')),
        projectPara: textOrNull(cell(row, 'project_para')),
        projectStatus: textOrNull(cell(row, 'project_status')),
      })),
    );
    if (result.rows.length < MEETING_SERIES_PAGE_SIZE && !result.truncated) return rows;
  }
}

async function readParticipants(
  index: Index,
  paths: readonly string[],
): Promise<SeriesParticipantRow[]> {
  const rows: SeriesParticipantRow[] = [];
  for (let from = 0; from < paths.length; from += PARTICIPANT_PATHS_PER_ASK) {
    const asked = paths.slice(from, from + PARTICIPANT_PATHS_PER_ASK);
    for (let page = 0; ; page += 1) {
      const { sql, parameters } = compileSeriesParticipantsQuery({ paths: asked, page });
      const result = await index.query(sql, parameters);
      const cell = cellsOf(result);
      rows.push(
        ...result.rows.map((row) => ({
          path: String(cell(row, 'path')),
          kind: String(cell(row, 'kind')),
          value: textOrNull(cell(row, 'value')),
        })),
      );
      if (result.rows.length < MEETING_SERIES_PAGE_SIZE && !result.truncated) break;
    }
  }
  return rows;
}

function cellsOf(result: QueryResult) {
  return (row: readonly unknown[], name: string): unknown => row[result.columns.indexOf(name)];
}

function textOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

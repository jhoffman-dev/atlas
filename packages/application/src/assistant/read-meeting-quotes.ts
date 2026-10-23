import {
  aboutWords,
  createVaultPath,
  datedNote,
  linkingAmong,
  meetingQuotes,
  meetingTurnsOf,
  namesOf,
  speaksInMeetings,
  type DatedNote,
  type ItemContext,
  type SpeakerQuote,
  type TranscriptTurn,
  type TurnFilter,
  type VaultPath,
} from '@dfai/domain';
import type { Clock } from '../ports.ts';
import { readLinkedPage } from '../linked-pages/read-linked-page.ts';
import { VaultAccessError } from '../vault/ports.ts';
import {
  citedEntity,
  problemsOf,
  type AssistantReads,
  type CitedEntity,
  type SectionProblem,
} from './assistant-reads.ts';
import type { FoundPassage, PassageFinder } from './ports.ts';
import { readAssistantEntity } from './read-entity.ts';

/** The most meeting files one answer reads, however many meetings match: a bound on the work, not on the vault. */
export const MEETINGS_READ_CAP = 50;

/** A meeting, and what was said in it that the question asked for. */
export interface QuotedMeeting extends DatedNote {
  /** The turns wanted, in the order spoken, at most `QUOTES_PER_MEETING`. */
  readonly quotes: readonly SpeakerQuote[];
  /** How many turns were wanted before the cap. */
  readonly matched: number;
}

/** `meetings(entity, since, about)`: a page's meetings, with who said what in them. */
export interface AssistantMeetings {
  readonly entity: CitedEntity;
  readonly since: string | null;
  readonly about: string | null;
  /** The names a person's turns were matched by — the title and aliases; null for a page that does not speak. */
  readonly speakers: readonly string[] | null;
  /** Newest first. With `about`, only meetings where a wanted turn was found. */
  readonly meetings: readonly QuotedMeeting[];
  /** More meetings matched than were read or listed. */
  readonly truncated: boolean;
  readonly problems: readonly SectionProblem[];
}

interface Asked {
  readonly since: string | null;
  readonly about: string | null;
  readonly limit: number;
}

/**
 * A Person's, Company's, Project's or Area's meetings (P32-04), as its
 * linked page lists them, on or after `since`, each with the turns that
 * answer the question: a person's own turns, and — with `about` — only the
 * turns holding it, in meetings the `finder` found it in. Only the meetings
 * answered are read from the vault, at most {@link MEETINGS_READ_CAP};
 * nothing is written.
 */
export async function readMeetingQuotes({
  reads,
  clock,
  finder,
  path,
  asked,
}: {
  reads: AssistantReads;
  clock: Pick<Clock, 'today'>;
  finder: PassageFinder;
  path: VaultPath;
  asked: Asked;
}): Promise<AssistantMeetings> {
  const entity = await readAssistantEntity({ ...reads, path, tool: 'meetings' });
  const sections = await readLinkedPage({
    ...reads,
    clock,
    asWritten: true,
    notePath: path,
    typeName: entity.type,
    ranges: { meetings: 'all' },
    only: ['meetings'],
  });
  const context = { ...linkingAmong(reads.notePaths), sources: new Map(), day: clock.today() };
  const listed = sections.flatMap((section) => section.rows).map((row) => datedNote(row, context));
  const inRange = listed.filter((meeting) => since(meeting, asked.since));
  const speakers = speaksInMeetings(entity.type) ? namesOf(entity.title, entity.frontmatter) : null;
  const answered = await quotedMeetings({ reads, finder, inRange, speakers, asked, context });
  return {
    entity: citedEntity(entity, context),
    since: asked.since,
    about: asked.about,
    speakers,
    meetings: answered.meetings,
    truncated: answered.truncated || sections.some((section) => section.truncated),
    problems: problemsOf(sections),
  };
}

/** On or after the day; with no day, every meeting. An undated one cannot be said to be after it. */
function since(meeting: DatedNote, day: string | null): boolean {
  return day === null || (meeting.date !== null && meeting.date >= day);
}

interface Quoting {
  readonly reads: AssistantReads;
  readonly finder: PassageFinder;
  readonly inRange: readonly DatedNote[];
  readonly speakers: readonly string[] | null;
  readonly asked: Asked;
  readonly context: ItemContext;
}

/** The meetings answered, newest first, and whether more matched than were read or listed. */
async function quotedMeetings(quoting: Quoting): Promise<{
  meetings: QuotedMeeting[];
  truncated: boolean;
}> {
  const { asked, inRange } = quoting;
  if (asked.about === null) {
    const read = await readQuoted(quoting, inRange.slice(0, asked.limit), () => null);
    return { meetings: read, truncated: inRange.length > asked.limit };
  }
  const words = aboutWords(asked.about);
  if (words === null) return { meetings: [], truncated: false };
  const found = await quoting.finder.find({
    about: asked.about,
    within: inRange.map((meeting) => meeting.path),
    limit: MEETINGS_READ_CAP,
  });
  const byPath = new Map(found.map((passage) => [passage.path, passage]));
  const candidates = inRange.filter((meeting) => byPath.has(meeting.path));
  const read = await readQuoted(quoting, candidates, (meeting) =>
    passageFilter(byPath.get(meeting.path), words),
  );
  const answered = read.filter((meeting) => meeting.quotes.length > 0);
  return {
    meetings: answered.slice(0, asked.limit),
    truncated: answered.length > asked.limit || candidates.length > MEETINGS_READ_CAP,
  };
}

/** What a found passage asks of a meeting's turns: the blocks it named, or else the words. */
function passageFilter(
  passage: FoundPassage | undefined,
  words: readonly string[],
): Pick<TurnFilter, 'words' | 'blocks'> {
  return passage?.blocks === null || passage === undefined
    ? { words, blocks: null }
    : { words: null, blocks: new Set(passage.blocks) };
}

/** Reads each meeting — at most {@link MEETINGS_READ_CAP} — and quotes the turns its filter wants. */
async function readQuoted(
  { reads, speakers, context }: Quoting,
  meetings: readonly DatedNote[],
  about: (meeting: DatedNote) => Pick<TurnFilter, 'words' | 'blocks'> | null,
): Promise<QuotedMeeting[]> {
  return Promise.all(
    meetings.slice(0, MEETINGS_READ_CAP).map(async (meeting) => {
      const path = createVaultPath(meeting.path);
      const turns = await turnsOf(reads, path);
      const filter: TurnFilter = { speakers, words: null, blocks: null, ...about(meeting) };
      // A page that does not speak, asked nothing about, is listed without quotes: every turn is no answer.
      const asksNothing =
        filter.speakers === null && filter.words === null && filter.blocks === null;
      const quoted = asksNothing
        ? { quotes: [], matched: 0 }
        : meetingQuotes({ path, turns, filter, targetOf: context.targetOf });
      return { ...meeting, ...quoted };
    }),
  );
}

/** A meeting's turns as its file holds them now; none for a file gone since the index listed it. */
async function turnsOf(
  reads: Pick<AssistantReads, 'fs'>,
  path: VaultPath,
): Promise<readonly TranscriptTurn[]> {
  try {
    return meetingTurnsOf((await reads.fs.readTextFile(path)).text);
  } catch (error) {
    // The index can be a moment behind the files: a meeting deleted since says nothing.
    if (error instanceof VaultAccessError) return [];
    throw error;
  }
}

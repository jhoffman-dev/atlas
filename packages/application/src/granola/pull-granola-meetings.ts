import {
  explainGranolaFailure,
  granolaFailureEffect,
  granolaFailureWords,
  granolaLateArrivalReport,
  granolaNoteReport,
  granolaNoteToFields,
  granolaPullReport,
  isStaleArrival,
  MeetingMappingError,
  messageWithoutPaths,
  nextWatermark,
  parseGranolaSettings,
  sinceOf,
  TRANSCRIPT_TOO_LONG,
  type GranolaFailure,
  type GranolaFileOptions,
  type GranolaNote,
  type GranolaNoteOutcome,
  type GranolaNoteProblem,
  type GranolaNoteResult,
  type GranolaNoteSummary,
  type GranolaPullEnd,
  type GranolaPullMode,
  type VaultPath,
} from '@atlas/domain';
import type { ActivityLog, ActivityRecorder } from '../activity/ports.ts';
import { meetingHoldersIn, type HolderPorts } from '../meetings/meeting-files.ts';
import { MeetingPathsTakenError, receiveMeeting } from '../meetings/receive-meeting.ts';
import type { Clock } from '../ports.ts';
import { readVaultSettings } from '../settings/index.ts';
import { listGranolaNotes, readGranolaNote, type GranolaReader } from './granola-reading.ts';
import { pacedRequests, type Wait } from './granola-requests.ts';
import { loadGranolaMappingOptions } from './granola-settings.ts';
import { GranolaError, type GranolaPort, type GranolaPullRecords } from './ports.ts';

/** What a pull reads and writes: the vault (as `receiveMeeting` writes it), Granola, and this Mac's record. */
export interface GranolaPullPorts extends HolderPorts {
  readonly granola: GranolaPort;
  readonly records: GranolaPullRecords;
}

/** What a pull did. Nothing in it is a note's content, or the key. */
export interface GranolaPullReport {
  readonly vault: string;
  readonly mode: GranolaPullMode;
  readonly ended: GranolaPullEnd;
  /** The files written into `Inbox/Meetings/`. */
  readonly written: readonly VaultPath[];
  /** Notes the vault already held: never fetched, or found held when written. */
  readonly held: number;
  /** Notes the mapper refused, or whose transcript is past the limit. */
  readonly refused: readonly GranolaNoteProblem[];
  /** Notes Granola refused in a way that comes back the same on every pull. */
  readonly skipped: readonly GranolaNoteProblem[];
  /** Notes that failed in a way that may pass: the next pull lists them again. */
  readonly failed: readonly GranolaNoteProblem[];
  /** Granola's failure that stopped or failed the pull. */
  readonly failure: GranolaFailure | null;
  /** Why the pull stopped or failed, in the person's words; null when it did neither. */
  readonly problem: string | null;
  /** Granola refused the key (401): the card says so until a new one is set. */
  readonly keyRefused: boolean;
  /** The watermark this Mac keeps for the vault after the pull. */
  readonly watermark: string | null;
}

export interface GranolaPullDeps {
  /** The ports as they are now, asked for at the start of each pull. */
  readonly ports: () => GranolaPullPorts;
  readonly clock: Pick<Clock, 'now'>;
  readonly wait: Wait;
  readonly activity: ActivityLog;
  /** The vault open now, which the ports answer for; null when none is. */
  readonly openVault: () => string | null;
  /**
   * Whether a git sync pull of the vault has completed in this session of
   * the app (ADR-0034). Until one has, this Mac may write a meeting another
   * Mac has already imported and changed, and the two would conflict. The
   * caller knows; the pull does not start without it.
   */
  readonly syncedThisSession: (vault: string) => boolean;
}

/** The one way Granola is pulled: on open, on the timer, by Sync now and by the API alike. */
export interface GranolaPuller {
  /** Pulls the vault; while a pull of it runs, that one's report. Never rejects. */
  pull(args: { vault: string; mode: GranolaPullMode }): Promise<GranolaPullReport>;
}

/**
 * Pulls Granola's notes into the vault, one pull per vault at a time: one
 * asked for while another runs is answered with that one's report, so Sync
 * now pressed during the startup pull never fetches a note twice.
 */
export function createGranolaPuller(deps: GranolaPullDeps): GranolaPuller {
  const running = new Map<string, Promise<GranolaPullReport>>();
  return {
    pull({ vault, mode }) {
      const already = running.get(vault);
      if (already !== undefined) return already;
      const pulling = pullGranolaMeetings(deps, { vault, mode }).finally(() => {
        running.delete(vault);
      });
      running.set(vault, pulling);
      return pulling;
    },
  };
}

/** What a pull has done to its notes so far. */
interface Tally {
  readonly results: GranolaNoteResult[];
  readonly written: { readonly path: VaultPath; readonly summary: GranolaNoteSummary }[];
  held: number;
  readonly refused: GranolaNoteProblem[];
  readonly skipped: GranolaNoteProblem[];
  readonly failed: GranolaNoteProblem[];
}

/** One pull, under way. */
interface PullRun extends GranolaReader {
  readonly mode: GranolaPullMode;
  readonly ports: GranolaPullPorts;
  readonly recorder: ActivityRecorder;
  readonly stillOpen: () => boolean;
  readonly settings: Readonly<Record<string, unknown>>;
  /** The mapper's options, read once the first note needs them. */
  readonly mappingOptions: () => Promise<GranolaFileOptions>;
  readonly tally: Tally;
}

/** How a pull ended, and why. */
interface Ending {
  readonly ended: GranolaPullEnd;
  readonly failure: GranolaFailure | null;
  readonly problem: string | null;
}

const endedBy = (ended: GranolaPullEnd): Ending => ({ ended, failure: null, problem: null });

async function pullGranolaMeetings(
  deps: GranolaPullDeps,
  { vault, mode }: { vault: string; mode: GranolaPullMode },
): Promise<GranolaPullReport> {
  const ports = deps.ports();
  const recorder = deps.activity.inVault(vault);
  const tally: Tally = { results: [], written: [], held: 0, refused: [], skipped: [], failed: [] };
  const before = ports.records.read(vault).watermark;
  const ending = deps.syncedThisSession(vault)
    ? await pullInto({ deps, vault, mode, ports, recorder, tally }, before).catch(
        (cause: unknown): Ending => ({
          ended: 'failed',
          failure: null,
          problem: messageWithoutPaths(cause),
        }),
      )
    : endedBy('not-synced');
  const watermark = keepWatermark({ deps, vault, ports, tally, ending, before });
  const report = reportOf({ vault, mode, tally, ending, watermark });
  const line = granolaPullReport({
    ended: ending.ended,
    counts: countsOf(report),
    problem: ending.problem,
  });
  if (line !== null) recorder.record(line);
  return report;
}

/** Lists the notes, and takes in each the vault does not hold; how the pull ended. */
async function pullInto(
  {
    deps,
    vault,
    mode,
    ports,
    recorder,
    tally,
  }: {
    deps: GranolaPullDeps;
    vault: string;
    mode: GranolaPullMode;
    ports: GranolaPullPorts;
    recorder: ActivityRecorder;
    tally: Tally;
  },
  before: string | null,
): Promise<Ending> {
  const stillOpen = () => deps.openVault() === vault;
  if (!stillOpen()) return endedBy('vault-changed');
  const settings = await readVaultSettings(ports);
  let options: Promise<GranolaFileOptions> | null = null;
  const run: PullRun = {
    vault,
    mode,
    ports,
    granola: ports.granola,
    send: pacedRequests({ clock: deps.clock, wait: deps.wait }),
    recorder,
    stillOpen,
    settings,
    mappingOptions: () => (options ??= loadGranolaMappingOptions({ settings, index: ports.index })),
    tally,
  };
  const since = sinceOf({ watermark: before, mode });
  let listed: readonly GranolaNoteSummary[];
  try {
    listed = await listGranolaNotes(run, since);
  } catch (error) {
    return endingOf(run, failureOf(error), 'failed');
  }
  for (const summary of listed) {
    const ending = await takeIn(run, summary);
    if (ending !== null) return ending;
  }
  warnOfLateArrivals(run, { since, now: deps.clock.now() });
  return endedBy('pulled');
}

/** A failure from Granola; anything else thrown is passed on. */
function failureOf(error: unknown): GranolaFailure {
  if (error instanceof GranolaError) return error.failure;
  throw error;
}

/** How a failure ends the pull: once the vault has changed, that is why, whatever Granola said. */
function endingOf(run: PullRun, failure: GranolaFailure, ended: 'stopped' | 'failed'): Ending {
  if (!run.stillOpen()) return endedBy('vault-changed');
  return { ended, failure, problem: granolaFailureWords(failure) };
}

/**
 * Takes in one listed note: held when the vault has it (by provider and id,
 * as the import counts holders), and then never fetched; else fetched,
 * mapped and written through `receiveMeeting`. Null to go on to the next
 * note; how the pull ends, when this note ends it.
 */
async function takeIn(run: PullRun, summary: GranolaNoteSummary): Promise<Ending | null> {
  if (!run.stillOpen()) return endedBy('vault-changed');
  if (await heldInVault(run.ports, summary.id)) {
    settle(run, summary, 'held');
    return null;
  }
  let note: GranolaNote | null;
  try {
    note = await readGranolaNote(run, summary.id);
  } catch (error) {
    return noteFailed(run, summary, failureOf(error));
  }
  if (note === null) {
    settle(run, summary, 'refused', problemOf(summary, null, TRANSCRIPT_TOO_LONG));
    return null;
  }
  if (!run.stillOpen()) return endedBy('vault-changed');
  return write(run, summary, note);
}

async function heldInVault(ports: HolderPorts, id: string): Promise<boolean> {
  const { imported, unsettled } = await meetingHoldersIn(ports, {
    meeting: { provider: 'granola', externalId: id },
    skip: () => false,
  });
  return imported.length + unsettled.length > 0;
}

/** A note Granola would not give: left for the next pull, settled, or the end of the pull. */
function noteFailed(
  run: PullRun,
  summary: GranolaNoteSummary,
  failure: GranolaFailure,
): Ending | null {
  const effect = granolaFailureEffect(failure);
  if (effect === 'stop') return endingOf(run, failure, 'stopped');
  if (!run.stillOpen()) return endedBy('vault-changed');
  if (effect === 'retry') {
    const { problem } = explainGranolaFailure(failure);
    settle(run, summary, 'failed', problemOf(summary, null, problem));
  } else {
    settle(run, summary, 'skipped', problemOf(summary, null, granolaFailureWords(failure)));
  }
  return null;
}

/** Maps the note by the vault's options and writes it through `receiveMeeting`, the one writer. */
async function write(
  run: PullRun,
  summary: GranolaNoteSummary,
  note: GranolaNote,
): Promise<Ending | null> {
  try {
    const { timeZone, selfEmails, groupAddresses } = await run.mappingOptions();
    const fields = granolaNoteToFields(note, { timeZone, selfEmails });
    const receipt = await receiveMeeting({ ports: run.ports, fields, options: { groupAddresses } });
    if (receipt.outcome === 'written') run.tally.written.push({ path: receipt.path, summary });
    settle(run, summary, receipt.outcome === 'written' ? 'written' : 'held');
    return null;
  } catch (error) {
    if (!run.stillOpen()) return endedBy('vault-changed');
    const refused = error instanceof MeetingMappingError || error instanceof MeetingPathsTakenError;
    const problem = problemOf(summary, note, messageWithoutPaths(error));
    settle(run, summary, refused ? 'refused' : 'failed', problem);
    return null;
  }
}

/** Counts what became of a note, and says in Activity why one was not written. */
function settle(
  run: PullRun,
  summary: GranolaNoteSummary,
  outcome: GranolaNoteOutcome,
  problem?: GranolaNoteProblem,
): void {
  run.tally.results.push({ outcome, updatedAt: summary.updated_at });
  if (outcome === 'held') run.tally.held += 1;
  if (problem === undefined || outcome === 'written' || outcome === 'held') return;
  run.tally[outcome].push(problem);
  run.recorder.record(granolaNoteReport(outcome, problem));
}

function problemOf(
  summary: GranolaNoteSummary,
  note: GranolaNote | null,
  problem: string,
): GranolaNoteProblem {
  const url = note?.web_url ?? null;
  return { id: summary.id, title: summary.title, url: url === '' ? null : url, problem };
}

/**
 * Warns when a pull from the watermark wrote a note the webhook should have
 * brought hours ago: only where the vault says the webhook is set up, and
 * never on a full listing, which finds old notes by design.
 */
function warnOfLateArrivals(run: PullRun, { since, now }: { since: string | null; now: number }) {
  if (since === null || !parseGranolaSettings(run.settings).webhook) return;
  const late = run.tally.written.filter(({ summary }) =>
    isStaleArrival({ updatedAt: summary.updated_at, now }),
  ).length;
  if (late > 0) run.recorder.record(granolaLateArrivalReport(late));
}

/**
 * The watermark kept after the pull: moved on only when every listed note
 * was looked at. A pull that ended early has not seen the notes it did not
 * reach, and must not pass them.
 */
function keepWatermark({
  deps,
  vault,
  ports,
  tally,
  ending,
  before,
}: {
  deps: GranolaPullDeps;
  vault: string;
  ports: GranolaPullPorts;
  tally: Tally;
  ending: Ending;
  before: string | null;
}): string | null {
  if (ending.ended !== 'pulled') return before;
  const watermark = nextWatermark({ watermark: before, results: tally.results });
  ports.records.write(vault, { watermark, lastPullAt: deps.clock.now() });
  return watermark;
}

function reportOf({
  vault,
  mode,
  tally,
  ending,
  watermark,
}: {
  vault: string;
  mode: GranolaPullMode;
  tally: Tally;
  ending: Ending;
  watermark: string | null;
}): GranolaPullReport {
  const { failure } = ending;
  return {
    vault,
    mode,
    ended: ending.ended,
    written: tally.written.map(({ path }) => path),
    held: tally.held,
    refused: tally.refused,
    skipped: tally.skipped,
    failed: tally.failed,
    failure,
    problem: ending.problem,
    keyRefused: failure?.kind === 'api_refused' && failure.status === 401,
    watermark,
  };
}

function countsOf(report: GranolaPullReport) {
  return {
    written: report.written.length,
    held: report.held,
    refused: report.refused.length,
    skipped: report.skipped.length,
    failed: report.failed.length,
  };
}

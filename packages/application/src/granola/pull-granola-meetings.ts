import {
  explainGranolaFailure,
  GRANOLA_KEPT_SLOWING_DOWN,
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
  sinceOf,
  SLOW_DOWNS_IN_A_ROW,
  TRANSCRIPT_TOO_LONG,
  unreadableSummaryProblem,
  type GranolaFailure,
  type GranolaFailureContext,
  type GranolaNote,
  type GranolaNoteOutcome,
  type GranolaNoteProblem,
  type GranolaNoteResult,
  type GranolaNoteSummary,
  type GranolaPullEnd,
  type GranolaPullMode,
  type GranolaSettings,
  type GranolaUnreadableSummary,
  type VaultPath,
} from '@atlas/domain';
import type { ActivityLog, ActivityRecorder } from '../activity/ports.ts';
import { meetingHoldersIn, type HolderPorts } from '../meetings/meeting-files.ts';
import { MeetingPathsTakenError, receiveMeeting } from '../meetings/receive-meeting.ts';
import type { Clock } from '../ports.ts';
import {
  listGranolaNotes,
  readGranolaNote,
  unreadableKey,
  type GranolaListing,
  type GranolaNoteRead,
  type GranolaReader,
} from './granola-reading.ts';
import { isSlowDown, pacedRequests, type Wait } from './granola-requests.ts';
import { loadGranolaSettings } from './granola-settings.ts';
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
  /**
   * Notes Granola refused in a way that comes back the same on every pull,
   * and notes it listed in a shape Atlas cannot read.
   */
  readonly skipped: readonly GranolaNoteProblem[];
  /** Notes that failed in a way that may pass: the next pull lists them again. */
  readonly failed: readonly GranolaNoteProblem[];
  /** Granola's failure that stopped or failed the pull. */
  readonly failure: GranolaFailure | null;
  /** Why the pull stopped or failed, in the person's words; null when it did neither. */
  readonly problem: string | null;
  /** Granola refused the key (401): the card says so until a new one is set. */
  readonly keyRefused: boolean;
  /**
   * The watermark this Mac keeps for the vault after the pull; null too when
   * a fault ended the pull before it could tell.
   */
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
  /**
   * Pulls the vault, one pull of it at a time. Asked for while one runs:
   * that one's report, except Sync now during a startup or timed pull, which
   * runs right after it (once, however often it is pressed meanwhile) so the
   * person gets the full listing they asked for. Never rejects. A listed
   * note it cannot read is said in the vault's Activity once in a session
   * of the app, and counted as skipped on every pull.
   */
  pull(args: { vault: string; mode: GranolaPullMode }): Promise<GranolaPullReport>;
}

/** A pull of a vault, running or waiting its turn. */
interface Flight {
  readonly mode: GranolaPullMode;
  readonly report: Promise<GranolaPullReport>;
}

/** A vault's pull under way, and the Sync now waiting for it to end. */
interface VaultFlights {
  readonly running: Flight;
  queued: (Flight & { readonly begin: () => void }) | null;
}

/**
 * Pulls Granola's notes into the vault, one pull per vault at a time, so no
 * note is fetched twice: a startup or timed pull asked for while another
 * runs is answered with that one's report, and so is Sync now while a Sync
 * now runs. Sync now pressed during a startup or timed pull, which list only
 * from the watermark, waits for it and then lists everything.
 */
export function createGranolaPuller(deps: GranolaPullDeps): GranolaPuller {
  const flights = new Map<string, VaultFlights>();
  const saidUnreadable = new Map<string, Set<string>>();

  /** The unreadable notes Activity has been told of in this vault, in this session of the app. */
  const saidUnreadableIn = (vault: string): Set<string> => {
    const said = saidUnreadable.get(vault) ?? new Set<string>();
    saidUnreadable.set(vault, said);
    return said;
  };

  const start = (vault: string, mode: GranolaPullMode): Promise<GranolaPullReport> => {
    const report = pullGranolaMeetings(deps, {
      vault,
      mode,
      saidUnreadable: saidUnreadableIn(vault),
    });
    const state: VaultFlights = { running: { mode, report }, queued: null };
    flights.set(vault, state);
    // The first to hear the pull end, however it ends, so the vault is freed and the
    // queued Sync now starts before any caller can ask again.
    const ended = () => {
      flights.delete(vault);
      state.queued?.begin();
    };
    void report.then(ended, ended);
    return report;
  };

  const queueSyncNow = (vault: string, state: VaultFlights): Promise<GranolaPullReport> => {
    let begin = () => {};
    const report = new Promise<GranolaPullReport>((resolve) => {
      begin = () => resolve(start(vault, 'sync-now'));
    });
    state.queued = { mode: 'sync-now', report, begin };
    return report;
  };

  return {
    pull({ vault, mode }) {
      const state = flights.get(vault);
      if (state === undefined) return start(vault, mode);
      if (mode !== 'sync-now' || state.running.mode === 'sync-now') return state.running.report;
      return state.queued?.report ?? queueSyncNow(vault, state);
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
  /** Of the skipped, the unreadable notes an earlier pull this session already said in Activity. */
  skippedBefore: number;
  readonly failed: GranolaNoteProblem[];
  /** Notes fetched one after another that each ended in Granola's 429. */
  slowDownsInARow: number;
}

const noNotesYet = (): Tally => ({
  results: [],
  written: [],
  held: 0,
  refused: [],
  skipped: [],
  skippedBefore: 0,
  failed: [],
  slowDownsInARow: 0,
});

/**
 * What a pull has done, kept outside it, so a fault at any point reports
 * what came before: the notes as far as they went, the watermark the record
 * holds (null until it has been read), and Granola's failure that ended the
 * pull (null until one has).
 */
interface Progress {
  readonly tally: Tally;
  watermark: string | null;
  failure: GranolaFailure | null;
}

/** A pull asked for, with what it must not say twice in the vault's Activity. */
interface PullRequest {
  readonly vault: string;
  readonly mode: GranolaPullMode;
  /** Keys of the unreadable notes said in this vault's Activity this session; a pull adds those it says. */
  readonly saidUnreadable: Set<string>;
}

/** One pull, under way. */
interface PullRun extends GranolaReader {
  readonly mode: GranolaPullMode;
  readonly ports: GranolaPullPorts;
  readonly recorder: ActivityRecorder;
  readonly stillOpen: () => boolean;
  /** The vault's settings, the mapper's options among them. */
  readonly settings: GranolaSettings;
  readonly tally: Tally;
  readonly saidUnreadable: Set<string>;
}

/** How a pull ended, and why. */
interface Ending {
  readonly ended: GranolaPullEnd;
  readonly failure: GranolaFailure | null;
  readonly problem: string | null;
  /** False for a pull that did nothing at all, of which Activity is told nothing. */
  readonly began?: false;
}

const endedBy = (ended: GranolaPullEnd): Ending => ({ ended, failure: null, problem: null });

/**
 * A pull whose vault was no longer open when it was to begin — a Sync now
 * that waited its turn while another vault was opened, say. It asked
 * Granola nothing and wrote nothing, so it has nothing to say in the vault
 * it never pulled.
 */
const NEVER_BEGAN: Ending = { ...endedBy('vault-changed'), began: false };

/** One pull, which never rejects: a fault anywhere, in a port or a dependency, is a `failed` report. */
async function pullGranolaMeetings(
  deps: GranolaPullDeps,
  request: PullRequest,
): Promise<GranolaPullReport> {
  const progress: Progress = { tally: noNotesYet(), watermark: null, failure: null };
  try {
    return await pullAndReport(deps, request, progress);
  } catch (cause) {
    return faultReport(deps, request, cause, progress);
  }
}

async function pullAndReport(
  deps: GranolaPullDeps,
  { vault, mode, saidUnreadable }: PullRequest,
  progress: Progress,
): Promise<GranolaPullReport> {
  const { tally } = progress;
  const ports = deps.ports();
  const recorder = deps.activity.inVault(vault);
  const before = ports.records.read(vault).watermark;
  progress.watermark = before;
  const ending = deps.syncedThisSession(vault)
    ? await pullInto({ deps, vault, mode, ports, recorder, tally, saidUnreadable }, before).catch(
        (cause: unknown): Ending => ({
          ended: 'failed',
          failure: null,
          problem: messageWithoutPaths(cause),
        }),
      )
    : endedBy('not-synced');
  progress.failure = ending.failure;
  progress.watermark = keepWatermark({ deps, vault, ports, tally, ending, before });
  const report = reportOf({ vault, mode, tally, ending, watermark: progress.watermark });
  const line =
    ending.began === false
      ? null
      : granolaPullReport({
          mode,
          ended: ending.ended,
          counts: countsOf(report),
          problem: ending.problem,
          skippedBefore: tally.skippedBefore,
        });
  if (line !== null) recorder.record(line);
  return report;
}

/**
 * The report of a pull a fault ended outside what a pull handles — a port
 * that could not be had, a record that could not be read or kept — said in
 * Activity too, with what the pull had done before it: the meetings already
 * written stay written, the watermark is the one the record holds, and
 * Granola's failure, a refused key among them, is still the report's.
 * Should Activity fail as well, the report says so, since nothing else can.
 */
function faultReport(
  deps: GranolaPullDeps,
  { vault, mode }: PullRequest,
  cause: unknown,
  { tally, watermark, failure }: Progress,
): GranolaPullReport {
  const problem = messageWithoutPaths(cause);
  const ending: Ending = { ended: 'failed', failure, problem };
  const report = reportOf({ vault, mode, tally, ending, watermark });
  const line = granolaPullReport({ mode, ended: 'failed', counts: countsOf(report), problem });
  try {
    if (line !== null) deps.activity.inVault(vault).record(line);
    return report;
  } catch (unrecorded) {
    const why = messageWithoutPaths(unrecorded);
    return { ...report, problem: `${problem}; Activity could not record it either: ${why}` };
  }
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
    saidUnreadable,
  }: {
    deps: GranolaPullDeps;
    vault: string;
    mode: GranolaPullMode;
    ports: GranolaPullPorts;
    recorder: ActivityRecorder;
    tally: Tally;
    saidUnreadable: Set<string>;
  },
  before: string | null,
): Promise<Ending> {
  const stillOpen = () => deps.openVault() === vault;
  if (!stillOpen()) return NEVER_BEGAN;
  const run: PullRun = {
    vault,
    mode,
    ports,
    granola: ports.granola,
    send: pacedRequests({ clock: deps.clock, wait: deps.wait }),
    recorder,
    stillOpen,
    settings: await loadGranolaSettings(ports),
    tally,
    saidUnreadable,
  };
  const since = sinceOf({ watermark: before, mode });
  let listing: GranolaListing;
  try {
    listing = await listGranolaNotes(run, since);
  } catch (error) {
    return endingOf(run, failureOf(error), 'failed', 'listing');
  }
  for (const summary of listing.unreadable) leaveOut(run, summary);
  for (const summary of listing.notes) {
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
function endingOf(
  run: PullRun,
  failure: GranolaFailure,
  ended: 'stopped' | 'failed',
  during: GranolaFailureContext = 'note',
): Ending {
  if (!run.stillOpen()) return endedBy('vault-changed');
  return { ended, failure, problem: granolaFailureWords(failure, during) };
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
  let read: GranolaNoteRead;
  try {
    read = await readGranolaNote(run, summary.id);
  } catch (error) {
    return noteFailed(run, summary, failureOf(error));
  }
  run.tally.slowDownsInARow = 0;
  if (read.tooLong) {
    settle(run, summary, 'refused', problemOf(summary, read.note, TRANSCRIPT_TOO_LONG));
    return null;
  }
  if (!run.stillOpen()) return endedBy('vault-changed');
  return write(run, summary, read.note);
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
  return keptSlowingDown(run, failure);
}

/**
 * Ends the pull once {@link SLOW_DOWNS_IN_A_ROW} notes in a row have each
 * been refused with 429 past their retries: Granola is refusing everything,
 * and each note left would wait out its backoff for nothing. The notes not
 * reached hold the watermark, as any pull that ends early does.
 */
function keptSlowingDown(run: PullRun, failure: GranolaFailure): Ending | null {
  run.tally.slowDownsInARow = isSlowDown(failure) ? run.tally.slowDownsInARow + 1 : 0;
  if (run.tally.slowDownsInARow < SLOW_DOWNS_IN_A_ROW) return null;
  return { ended: 'failed', failure, problem: GRANOLA_KEPT_SLOWING_DOWN };
}

/** Maps the note by the vault's options and writes it through `receiveMeeting`, the one writer. */
async function write(
  run: PullRun,
  summary: GranolaNoteSummary,
  note: GranolaNote,
): Promise<Ending | null> {
  try {
    const { timeZone, selfEmails, groupAddresses } = run.settings;
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

/**
 * A listed note the pull could not read, counted as skipped; its time
 * unknown, it has no say in the watermark. It comes back on every pull until
 * Granola mends it, so Activity is told of it once in a session of the app.
 */
function leaveOut(run: PullRun, summary: GranolaUnreadableSummary): void {
  const problem = unreadableSummaryProblem(summary);
  run.tally.skipped.push(problem);
  const key = unreadableKey(summary);
  if (run.saidUnreadable.has(key)) {
    run.tally.skippedBefore += 1;
    return;
  }
  run.recorder.record(granolaNoteReport('skipped', problem));
  run.saidUnreadable.add(key);
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
  if (since === null || !run.settings.webhook) return;
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
  const now = deps.clock.now();
  const watermark = nextWatermark({ watermark: before, results: tally.results, now });
  ports.records.write(vault, { watermark, lastPullAt: now });
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

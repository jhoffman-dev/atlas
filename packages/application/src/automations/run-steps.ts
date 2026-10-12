import {
  claudeStepRecord,
  claudeStepsOf,
  CLAUDE_ASKS_PER_RUN,
  CORRECT_TERMS_STEP,
  correctionStepRecord,
  failedStepRecord,
  linkStepRecord,
  messageWithoutPaths,
  noteTitle,
  skippedStepRecord,
  stepsFailedProblem,
  automationEntryReport,
  type ClaudeAction,
  type ClaudeRunInfo,
  type DoneAction,
  type LogEntry,
  type LoggedVersion,
  type NoteVersionRef,
  type PassedOver,
  type RuleStep,
  type RunTrigger,
  type StepRecord,
  type StepsAction,
  type VaultPath,
} from '@atlas/domain';
import { linkMeeting } from '../meeting-links/link-meeting.ts';
import { correctMeetingTerms } from '../meetings/meeting-corrections.ts';
import { ClaudeStepFailed, runClaudeStep } from './claude-step.ts';
import { withHandledKeys } from './handled-keys.ts';
import { writtenBy, type RuleTarget } from './note-runs.ts';
import type { AutomationPorts, AutomationRun } from './run-automation.ts';
import { VaultChangedError } from './vault-guard.ts';

/** What one step did to one note: its record for the log, and what it changed, made, left and asked. */
interface StepResult {
  readonly record: StepRecord;
  readonly done: readonly DoneAction[];
  readonly left: readonly PassedOver[];
  readonly claude?: ClaudeRunInfo;
  /** An error that must stop the whole run once what was done is on record: another vault opened, a disk refused. */
  readonly interruption?: unknown;
}

/** What a run of steps needs beyond the run itself. */
interface StepsRunArgs {
  readonly run: AutomationRun;
  readonly ports: AutomationPorts & { readonly notePaths: readonly VaultPath[] };
  readonly target: RuleTarget;
  readonly action: StepsAction;
  readonly trigger: RunTrigger;
  /** Notes the rule had handled that were deleted, for its log to say. */
  readonly went: readonly VaultPath[];
  readonly log: (entry: LogEntry) => Promise<void>;
}

/**
 * Runs a rule of several steps (P29-06) over the plan's notes: for each note,
 * every step in the order the rule lists them, and one log entry for that
 * note saying how each went. Settles with the last entry; the ones before it
 * are said in Activity here, since whoever started the run reports only what
 * it is handed back.
 *
 * - **A failed step stops the steps after it for that note**, which are
 *   logged as not run. What the steps before it did stays: the entry lists it
 *   and "Undo last run" can take it back. Such a note is not counted as
 *   handled, so a run by hand takes it again — and finds its earlier steps
 *   already done.
 * - **The deterministic steps do nothing twice.** A meeting the import let in
 *   was corrected and linked as it arrived, and carries the record of both;
 *   the steps then say "already", and write nothing. They do their work only
 *   on a meeting that has no record: one made by hand, or one whose linking
 *   failed as it was let in.
 * - **The Claude steps share one run's asks** (`CLAUDE_ASKS_PER_RUN`), and
 *   the hour's cap counts every one. A note is started only while there is an
 *   ask left for each Claude step it has; past that the rest wait for a run
 *   by hand, and the log says the run stopped short. Within a note, a step
 *   leaves one ask for each Claude step after it.
 */
export async function runSteps(args: StepsRunArgs): Promise<LogEntry> {
  const { run, target, action } = args;
  const { paths } = target.plan;
  const claudeSteps = claudeStepsOf(action).length;
  const recorder = run.activity.inVault(run.guard.vault);
  let asksLeft = CLAUDE_ASKS_PER_RUN;
  let last: LogEntry | null = null;
  for (const [at, path] of paths.entries()) {
    if (last !== null) reportEntry(recorder, run, last);
    const outcome = await runOnNote({ ...args, path, asksLeft });
    asksLeft -= outcome.asked;
    const more = at < paths.length - 1;
    // The next note needs an ask for each of its Claude steps, or it is not started at all.
    const outOfAsks = more && claudeSteps > 0 && asksLeft < claudeSteps;
    const entry = entryOf(args, {
      outcome,
      first: at === 0,
      capped: outOfAsks || (!more && target.plan.capped),
    });
    await args.log(entry);
    last = entry;
    if (outcome.interruption !== undefined) {
      // Said before it is raised: whoever started the run is told only that it stopped.
      reportEntry(recorder, run, entry);
      throw outcome.interruption;
    }
    if (outOfAsks) break;
  }
  // A plan with no notes is not handed here.
  return last!;
}

function reportEntry(
  recorder: ReturnType<AutomationRun['activity']['inVault']>,
  run: AutomationRun,
  entry: LogEntry,
): void {
  const report = automationEntryReport(run.rule, entry);
  if (report !== null) recorder.record(report);
}

/** One note's run: every step's record, what they did between them, and what Claude was asked. */
interface NoteOutcome {
  readonly path: VaultPath;
  readonly at: string;
  readonly records: readonly StepRecord[];
  readonly done: readonly DoneAction[];
  readonly left: readonly PassedOver[];
  readonly claude: ClaudeRunInfo | null;
  readonly asked: number;
  readonly versions: readonly LoggedVersion[];
  readonly interruption?: unknown;
}

async function runOnNote({
  run,
  ports,
  target,
  action,
  path,
  asksLeft,
}: StepsRunArgs & { path: VaultPath; asksLeft: number }): Promise<NoteOutcome> {
  const at = run.clock.localNow();
  const records: StepRecord[] = [];
  const done: DoneAction[] = [];
  const left: PassedOver[] = [];
  const asked: ClaudeRunInfo[] = [];
  let stopped = false;
  let interruption: unknown;
  for (const [index, step] of action.steps.entries()) {
    if (stopped) {
      records.push(skippedStepRecord(step));
      continue;
    }
    const spent = asked.reduce((sum, claude) => sum + (claude.asks ?? 0), 0);
    const after = claudeStepsOf({ ...action, steps: action.steps.slice(index + 1) }).length;
    const result = await carryOutStep({
      run,
      ports,
      step,
      path,
      at,
      maxAsks: Math.max(1, asksLeft - spent - after),
    });
    records.push(result.record);
    done.push(...result.done);
    left.push(...result.left);
    if (result.claude !== undefined) asked.push(result.claude);
    stopped = result.record.outcome === 'failed';
    interruption = result.interruption;
  }
  const claude = asked.length === 0 ? null : sumOf(asked);
  const failed = records.some((record) => record.outcome === 'failed');
  return {
    path,
    at,
    records,
    done,
    left,
    claude,
    asked: claude?.asks ?? 0,
    // A note whose steps did not all run is not handled: a run by hand takes it again.
    versions: failed ? [] : await versionsOf({ run, target, path, done }),
    ...(interruption !== undefined && { interruption }),
  };
}

/** The Claude steps of one note's run as one: the model, and everything they asked and left out between them. */
function sumOf(asked: readonly ClaudeRunInfo[]): ClaudeRunInfo {
  const total = (pick: (claude: ClaudeRunInfo) => number) =>
    asked.reduce((sum, claude) => sum + pick(claude), 0);
  const all = <Item>(pick: (claude: ClaudeRunInfo) => readonly Item[] | undefined): Item[] =>
    asked.flatMap((claude) => pick(claude) ?? []);
  const [asks, alreadyMade] = [total((each) => each.asks ?? 0), total((each) => each.alreadyMade ?? 0)];
  const [cut, dropped, adjusted] = [all((each) => each.cut), all((each) => each.dropped), all((each) => each.adjusted)];
  const warnings = [...new Set(all((each) => each.warnings))];
  return {
    model: asked[0]!.model,
    ms: total((each) => each.ms),
    ...(cut.length > 0 && { cut }),
    ...(asks > 0 && { asks }),
    ...(dropped.length > 0 && { dropped }),
    ...(adjusted.length > 0 && { adjusted }),
    ...(warnings.length > 0 && { warnings }),
    ...(alreadyMade > 0 && { alreadyMade }),
  };
}

/**
 * The versions a completed run records for its note: the one that set it off,
 * and — when a step wrote the note — the one that write left, with the keys
 * the rule's outputs know it by, so neither sets the rule off or is asked
 * about again.
 */
async function versionsOf({
  run,
  target,
  path,
  done,
}: Pick<StepsRunArgs, 'run' | 'target'> & {
  path: VaultPath;
  done: readonly DoneAction[];
}): Promise<LoggedVersion[]> {
  const heard: NoteVersionRef[] = (target.versions ?? []).filter((version) => version.path === path);
  const handled = heard.map((version) => ({ ...version, wrote: false }));
  const changed = done.filter((action) => 'path' in action && action.path === path);
  if (target.versions === null || changed.length === 0) return handled;
  try {
    const written = await writtenBy({ fs: run.ports.fs, done: changed });
    const keyed = await withHandledKeys({
      fs: run.ports.fs,
      markdown: run.ports.markdown,
      rule: run.rule,
      versions: written,
    });
    return [...handled, ...keyed.map((version) => ({ ...version, wrote: true }))];
  } catch {
    // Safe to go without: the log must still be written. The write heard back then sets the rule
    // off once more, and finds every step of it already done.
    return handled;
  }
}

/** One note's run as its log entry: a run, or — when a step failed — a run that could not finish. */
function entryOf(
  { trigger, went, target }: StepsRunArgs,
  { outcome, first, capped }: { outcome: NoteOutcome; first: boolean; capped: boolean },
): LogEntry {
  const { path, at, records, done, claude } = outcome;
  const steps = { note: path, records };
  const failedAt = records.findIndex((record) => record.outcome === 'failed');
  if (failedAt !== -1) {
    return {
      kind: 'failed',
      at,
      trigger,
      problem: stepsFailedProblem({ at: failedAt + 1, of: records.length, record: records[failedAt]! }),
      ...(claude !== null && { claude }),
      ...(done.length > 0 && { done }),
      steps,
    };
  }
  return {
    kind: 'run',
    at,
    trigger,
    done,
    // What the plan passed over is the run's, said once: with its first note.
    left: [...(first ? target.plan.passedOver : []), ...outcome.left],
    capped,
    ...(target.versions !== null && { versions: outcome.versions }),
    ...(first && went.length > 0 && { went }),
    ...(claude !== null && { claude }),
    steps,
  };
}

interface StepArgs {
  readonly run: AutomationRun;
  readonly ports: AutomationPorts & { readonly notePaths: readonly VaultPath[] };
  readonly step: RuleStep;
  readonly path: VaultPath;
  readonly at: string;
  readonly maxAsks: number;
}

/**
 * Carries out one step on one note. Whatever stops it — a refusal said in
 * words, a note being typed in, a model's answer that does not read — is the
 * step's failure, with why; another vault opening is that too, and is also
 * handed back to stop the run once the entry is written.
 */
async function carryOutStep(args: StepArgs): Promise<StepResult> {
  const { step } = args;
  try {
    if (step.kind === CORRECT_TERMS_STEP) return await correctStep(args);
    if (step.kind === 'claude') return await claudeStep({ ...args, step });
    return await linkStep(args);
  } catch (cause) {
    const record = failedStepRecord(step, messageWithoutPaths(cause));
    if (cause instanceof ClaudeStepFailed) {
      return {
        record,
        done: cause.made,
        left: [],
        claude: cause.claude,
        ...(cause.interruption !== undefined && { interruption: cause.interruption }),
      };
    }
    const interruption = cause instanceof VaultChangedError ? { interruption: cause } : {};
    return { record, done: [], left: [], ...interruption };
  }
}

async function correctStep({ ports, step, path }: StepArgs): Promise<StepResult> {
  const { records, state } = await correctMeetingTerms({ ports, path });
  const count = records.reduce((sum, record) => sum + record.count, 0);
  const outcome =
    state === 'corrected' || state === 'already' ? { kind: state, count } : { kind: state };
  return {
    record: correctionStepRecord(step, outcome),
    done: state === 'corrected' ? [{ kind: 'corrected', path, count }] : [],
    left: [],
  };
}

async function linkStep({ run, ports, step, path }: StepArgs): Promise<StepResult> {
  const linked = await linkMeeting({
    ports,
    path,
    today: run.clock.today(),
    selfName: ports.claude.selfName(),
  });
  if (linked.already !== undefined) {
    return {
      record: linkStepRecord(step, { kind: 'already', undone: linked.already.undone }),
      done: [],
      left: [],
    };
  }
  const proposed: DoneAction[] = linked.proposed.map((made) => ({ kind: 'proposed', path: made }));
  if (!linked.recorded) {
    // The meeting could not be written, so it holds no record and would be linked again: a failure, retried.
    const why = linked.left.find((each) => each.path === path)?.reason ?? 'It could not be written.';
    const record = failedStepRecord(step, `${noteTitle(path)} could not be linked. ${why}`);
    return { record, done: proposed, left: [] };
  }
  const reasons = [
    ...linked.left.map(({ path: at, reason }) => `${noteTitle(at)}: ${reason}`),
    ...(linked.unproposed === null ? [] : [`its proposals could not be written: ${linked.unproposed}`]),
  ];
  const count = linked.linked.length + linked.proposed.length;
  // Logged even when nothing was sure: the step wrote the meeting's record, and its write is the rule's own.
  return {
    record: linkStepRecord(step, {
      kind: 'linked',
      linked: linked.linked,
      proposed: linked.proposed.length,
      left: reasons,
    }),
    done: [{ kind: 'linked', path, count }, ...proposed],
    left: linked.left.filter((each) => each.path !== path),
  };
}

async function claudeStep({
  run,
  ports,
  step,
  path,
  at,
  maxAsks,
}: StepArgs & { step: ClaudeAction }): Promise<StepResult> {
  const { done, left, claude } = await runClaudeStep({
    ports: ports.claude,
    action: step,
    paths: [path],
    fs: ports.fs,
    index: ports.index,
    markdown: ports.markdown,
    notePaths: ports.notePaths,
    rule: run.rule.id,
    madeBy: `${run.rule.name} · ${at.replace('T', ' ')}`,
    maxAsks,
  });
  return { record: claudeStepRecord(step, { made: done.length, claude }), done, left, claude };
}

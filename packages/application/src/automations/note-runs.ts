import {
  createVaultPath,
  digestOf,
  handledVersions,
  MAX_ACTIONS_PER_RUN,
  noteRunsCappedProblem,
  unhandledVersions,
  type AutomationPlan,
  type AutomationRule,
  type DoneAction,
  type LogEntry,
  type LocalTime,
  type LoggedVersion,
  type NoteVersionRef,
  type VaultPath,
} from '@atlas/domain';
import type { VaultFsPort } from '../vault/ports.ts';
import { matchedPaths, planMatched, planRun, type RuleQueryPorts } from './plan-run.ts';

/** What a run acts on: the plan, and — for a rule notes set off — the versions it was made for. */
export interface RuleTarget {
  readonly plan: AutomationPlan;
  /** Null for a rule on a clock, which handles no versions. */
  readonly versions: readonly NoteVersionRef[] | null;
}

type PlanRule = Pick<AutomationRule, 'when' | 'which' | 'olderThanDays' | 'action'>;

/**
 * What a rule would do now: what its dry run shows, and a run by hand does.
 *
 * A rule on a clock plans over every note its query matches. A rule notes set
 * off (P29-01) plans over the notes its query matches whose version now — as
 * the index last read it — its log has not handled: run by hand, it does what
 * it would have done had each of them just appeared. Rejects as `planRun` does.
 */
export async function planRuleNow({
  ports,
  rule,
  log,
  today,
}: {
  ports: RuleQueryPorts;
  rule: PlanRule;
  /** The rule's log; empty for a rule not yet saved. */
  log: readonly LogEntry[];
  today: string;
}): Promise<RuleTarget> {
  if (rule.when.kind !== 'note')
    return { plan: await planRun({ ports, rule, today }), versions: null };
  const matched = await matchedPaths({ ports, rule, today });
  const versions = unhandledVersions(await versionsNow(ports, matched), handledVersions(log));
  const plan = await planMatched({
    ports,
    action: rule.action,
    matched: versions.map((version) => version.path),
  });
  return { plan, versions };
}

/**
 * What a rule does for the versions the change feed reported: its query asked
 * among those notes alone. Past the most one run may do, the rest wait for a
 * run by hand, and the run says it stopped short.
 */
export async function planForVersions({
  ports,
  rule,
  versions,
  today,
}: {
  ports: RuleQueryPorts;
  rule: PlanRule;
  versions: readonly NoteVersionRef[];
  today: string;
}): Promise<RuleTarget> {
  const taken = versions.slice(0, MAX_ACTIONS_PER_RUN);
  const among = taken.map((version) => version.path);
  const plan = await planRun({ ports, rule, today, among });
  return {
    plan: { ...plan, capped: plan.capped || versions.length > taken.length },
    versions: taken,
  };
}

/** The version of each note the index holds now; a note it does not hold is left out. */
async function versionsNow(
  ports: Pick<RuleQueryPorts, 'index'>,
  paths: readonly VaultPath[],
): Promise<NoteVersionRef[]> {
  const digests = new Map(
    (await ports.index.manifest()).map((entry) => [entry.path, entry.digest] as const),
  );
  return paths.flatMap((path) => {
    const digest = digests.get(path);
    return digest === undefined ? [] : [{ path, digest }];
  });
}

/**
 * The versions a run acted on, as its log records them so they never set it
 * off again. A version it did not act on is not recorded: heard again, it is
 * looked at again.
 */
export function handledBy(
  versions: readonly NoteVersionRef[],
  done: readonly DoneAction[],
): LoggedVersion[] {
  const actedOn = new Set(done.map((action) => ('path' in action ? action.path : action.from)));
  return versions
    .filter((version) => actedOn.has(version.path))
    .map((version) => ({ ...version, wrote: false }));
}

/**
 * The version each note a run wrote was left at, read back from the disk, so
 * the rule's own write does not set it off again: each note it changed or
 * moved, and each note an archive rewrote links in.
 */
export async function writtenBy({
  fs,
  done,
  relinked,
}: {
  fs: Pick<VaultFsPort, 'readNotes'>;
  done: readonly DoneAction[];
  relinked: readonly VaultPath[];
}): Promise<LoggedVersion[]> {
  const changed = done.map((action) => ('path' in action ? action.path : action.to));
  const written = [...new Set([...changed, ...relinked])];
  if (written.length === 0) return [];
  return (await fs.readNotes(written)).map((file) => ({
    path: createVaultPath(file.path),
    digest: digestOf(file.text),
    wrote: true,
  }));
}

/**
 * A rule notes set off that has run as often in the last hour as one may
 * (`NOTE_RUNS_PER_HOUR`). It is held back until `until`, when the hour
 * allows another run; what it heard meanwhile is run on then.
 */
export class NoteRunsCappedError extends Error {
  constructor(readonly until: LocalTime) {
    super(noteRunsCappedProblem(until));
    this.name = 'NoteRunsCappedError';
  }
}

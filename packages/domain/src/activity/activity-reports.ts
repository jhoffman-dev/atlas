/**
 * What each thing worth knowing says in the Activity log (U-28), and how
 * loudly: one line per event, a summary rather than the detail — a rule's own
 * log, the source's panel and the chat keep that.
 *
 * Nothing here takes a note's contents, a request's body or a chat's words;
 * only names, counts and why something failed.
 */

import { noteTitle } from '../vault/vault-entry.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import { logEntryHeading, logEntrySummary, type LogEntry } from '../automations/run-log.ts';
import type { AutomationPlan } from '../automations/automation-plan.ts';
import type { ActivityLevel, ActivityReport, ActivitySubject } from './activity-event.ts';

/** An automation's rule, as a line names it and links to it; a draft not yet saved has no path. */
export interface RuleNamed {
  readonly name: string;
  readonly path: VaultPath | null;
}

const ruleSubject = (rule: RuleNamed): ActivitySubject | null =>
  rule.path === null ? null : { kind: 'rule', path: rule.path };
const noteSubject = (path: VaultPath): ActivitySubject => ({ kind: 'note', path });

/**
 * A run or an undo, as its rule's log summed it up; null for what is no news —
 * a rule turned on, or first seen. A run that left notes alone is a warning:
 * something in the vault is not as the rule expects.
 */
export function automationEntryReport(rule: RuleNamed, entry: LogEntry): ActivityReport | null {
  if (entry.kind === 'turnedOn' || entry.kind === 'seen') return null;
  const level: ActivityLevel =
    entry.kind === 'failed' ? 'error' : entry.left.length > 0 ? 'warning' : 'info';
  const heading = entry.kind === 'undo' ? 'Undid its last run' : logEntryHeading(entry);
  const notes = entry.kind === 'run' ? triggeringNotes(entry) : '';
  return {
    level,
    kind: 'automation',
    message: `${rule.name}: ${heading}${notes}. ${logEntrySummary(entry)}`,
    subject: ruleSubject(rule),
  };
}

/** How many notes set off by a run a line names before it counts the rest. */
const TRIGGERING_NAMED = 3;

/** The notes that set a run off, as a line names them: ` (Standup, Kickoff and 2 more)`; empty for none. */
function triggeringNotes(entry: Extract<LogEntry, { kind: 'run' }>): string {
  const titles = (entry.versions ?? [])
    .filter((version) => !version.wrote)
    .map((version) => noteTitle(version.path));
  if (titles.length === 0) return '';
  const named = titles.slice(0, TRIGGERING_NAMED).join(', ');
  const more = titles.length - TRIGGERING_NAMED;
  return more > 0 ? ` (${named} and ${more} more)` : ` (${named})`;
}

/** A run or an undo that stopped before its log could say what it did. */
export function automationFailedReport({
  rule,
  doing,
  problem,
}: {
  rule: RuleNamed;
  doing: 'run' | 'undo';
  problem: string;
}): ActivityReport {
  const what = doing === 'run' ? 'Could not run' : 'Could not undo its last run';
  return {
    level: 'error',
    kind: 'automation',
    message: `${rule.name}: ${what}. ${problem}`,
    subject: ruleSubject(rule),
  };
}

/** A dry run from the rule's editor: what it would do, or why its query did not read. */
export function dryRunReport(
  rule: RuleNamed,
  outcome: { plan: AutomationPlan } | { problem: string },
): ActivityReport {
  if ('problem' in outcome) {
    return {
      level: 'warning',
      kind: 'automation',
      message: `${rule.name}: Dry run could not read its notes. ${outcome.problem}`,
      subject: ruleSubject(rule),
    };
  }
  const { plan } = outcome;
  const count = plan.paths.length;
  const verb = plan.action.kind === 'archive' ? 'archive' : 'change';
  const would = count === 0 ? 'Nothing to do' : `Would ${verb} ${notes(count)}`;
  const left = plan.passedOver.length === 0 ? '' : `, and leave ${plan.passedOver.length} alone`;
  return {
    level: 'info',
    kind: 'automation',
    message: `${rule.name}: Dry run. ${would}${left}.`,
    subject: ruleSubject(rule),
  };
}

/** What a source refresh reports, as far as the log needs it. */
export interface SourceOutcome {
  readonly records: number;
  readonly created: number;
  readonly replaced: number;
  readonly updated: number;
  readonly missing: number;
  readonly error: string | null;
}

/** A source refreshed, or failed to: named by its note, never by its URL, which may hold a key. */
export function sourceRefreshReport(sourcePath: VaultPath, outcome: SourceOutcome): ActivityReport {
  const name = noteTitle(sourcePath);
  const subject: ActivitySubject = { kind: 'source', path: sourcePath };
  if (outcome.error !== null) {
    return {
      level: 'error',
      kind: 'source',
      message: `${name}: Refresh failed. ${outcome.error}`,
      subject,
    };
  }
  const changes = [
    outcome.created > 0 ? `${outcome.created} new` : '',
    outcome.replaced + outcome.updated > 0 ? `${outcome.replaced + outcome.updated} updated` : '',
    outcome.missing > 0 ? `${outcome.missing} gone from the feed` : '',
  ].filter((part) => part !== '');
  const records = `${outcome.records} ${outcome.records === 1 ? 'record' : 'records'}`;
  const detail = changes.length === 0 ? 'nothing changed' : changes.join(', ');
  return {
    level: 'info',
    kind: 'source',
    message: `${name}: Refreshed. ${records}, ${detail}.`,
    subject,
  };
}

/**
 * A write through the local API or MCP: the route as the contract names it,
 * and the note it wrote — never what it wrote. A refused one is a warning:
 * the tool asked for something Atlas would not do.
 */
export function apiWriteReport({
  route,
  notePath,
  refusal,
}: {
  route: string;
  notePath: VaultPath | null;
  refusal: string | null;
}): ActivityReport {
  // `PUT v1/notes/{path}/body`: with its leading slash, a route reads as a machine path and is struck out.
  const said = route.replace(/ \//, ' ');
  const target = notePath === null ? '' : ` ${noteTitle(notePath)}`;
  const subject = notePath === null ? null : noteSubject(notePath);
  if (refusal !== null) {
    return {
      level: 'warning',
      kind: 'api',
      message: `${said} refused${target === '' ? '' : ` for${target}`} (${refusal}).`,
      subject,
    };
  }
  return {
    level: 'info',
    kind: 'api',
    message: `${said}${target === '' ? '' : ` —${target}`}`,
    subject,
  };
}

/** What happened to one of Claude's proposals, or to a turn of the chat. */
export type ChatHappening =
  | { readonly kind: 'accepted'; readonly path: VaultPath; readonly created: boolean }
  | { readonly kind: 'undone'; readonly path: VaultPath }
  | {
      readonly kind: 'refused';
      readonly doing: 'accept' | 'undo';
      readonly path: VaultPath;
      readonly problem: string;
    }
  | { readonly kind: 'turnFailed'; readonly reason: ChatFailure }
  | { readonly kind: 'notKept'; readonly problem: string };

/**
 * Why a turn failed, by kind alone. A provider's own words can quote the
 * question back, and a line is kept for a month, so they never reach it.
 */
export type ChatFailure = 'not_installed' | 'not_logged_in' | 'no_key' | 'unavailable' | 'failed';

const CHAT_FAILURE_WORDS: Readonly<Record<ChatFailure, string>> = {
  not_installed: 'Claude could not answer: Claude Code is not installed.',
  not_logged_in: 'Claude could not answer: Claude Code is not signed in.',
  no_key: 'Claude could not answer: no API key is set.',
  unavailable: 'Claude could not answer: the service could not be reached.',
  failed: 'Claude could not answer.',
};

export function chatReport(happening: ChatHappening): ActivityReport {
  switch (happening.kind) {
    case 'accepted': {
      const what = happening.created ? 'Created' : 'Edited';
      return chatLine(
        'info',
        `${what} ${noteTitle(happening.path)}, as Claude proposed.`,
        happening.path,
      );
    }
    case 'undone':
      return chatLine(
        'info',
        `Undid Claude's change to ${noteTitle(happening.path)}.`,
        happening.path,
      );
    case 'refused': {
      const what = happening.doing === 'accept' ? 'accept' : 'undo';
      const message = `Could not ${what} Claude's change to ${noteTitle(happening.path)}. ${happening.problem}`;
      return chatLine('warning', message, happening.path);
    }
    case 'turnFailed':
      return chatLine('error', CHAT_FAILURE_WORDS[happening.reason], null);
    case 'notKept':
      return chatLine('error', `The chat could not be saved to Chats/. ${happening.problem}`, null);
  }
}

function chatLine(level: ActivityLevel, message: string, path: VaultPath | null): ActivityReport {
  return { level, kind: 'chat', message, subject: path === null ? null : noteSubject(path) };
}

/** The index made again from nothing, and how many notes it holds. */
export function indexRebuiltReport(notes: number): ActivityReport {
  return {
    level: 'info',
    kind: 'index',
    message: `Rebuilt the index: ${notes} ${notes === 1 ? 'note' : 'notes'}.`,
    subject: null,
  };
}

/** The index could not be opened, rebuilt or brought up to date. */
export function indexFailedReport({
  rebuilding,
  problem,
}: {
  rebuilding: boolean;
  problem: string;
}): ActivityReport {
  const what = rebuilding ? 'could not be rebuilt' : 'could not be brought up to date';
  return { level: 'error', kind: 'index', message: `The index ${what}. ${problem}`, subject: null };
}

/** The writes a failed one can be, as its line says what was being done. */
export type VaultWrite = 'save' | 'create' | 'createFolder' | 'move' | 'trash' | 'writeFile';

const WRITE_WORDS: Readonly<Record<VaultWrite, string>> = {
  save: 'Could not save',
  create: 'Could not create',
  createFolder: 'Could not create the folder',
  move: 'Could not move',
  trash: 'Could not move to the Trash',
  writeFile: 'Could not write',
};

/**
 * A write to the vault that failed or was refused — a save over a note
 * changed since it was read, a write meant for a vault no longer open.
 */
export function writeFailedReport({
  write,
  path,
  problem,
}: {
  write: VaultWrite;
  path: VaultPath;
  problem: string;
}): ActivityReport {
  // Only a save names a note that is there to open; a failed create, move or trash does not.
  const subject = write === 'save' ? noteSubject(path) : null;
  return {
    level: 'error',
    kind: 'save',
    message: `${WRITE_WORDS[write]} ${path}. ${problem}`,
    subject,
  };
}

/** A notice the window showed: in red as an error, in amber as a warning. */
export function noticeReport(notice: string, level: ActivityLevel = 'error'): ActivityReport {
  return { level, kind: 'app', message: notice, subject: null };
}

function notes(count: number): string {
  return `${count} ${count === 1 ? 'note' : 'notes'}`;
}

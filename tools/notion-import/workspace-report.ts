import { allImported, reportLines } from './import-report.ts';
import type { PageOutcome, WorkspaceOutcome } from './import-notion-workspace.ts';

const named = (outcome: { database: string; title: string }) =>
  `${outcome.database} "${outcome.title || 'Untitled'}"`;

const keptLine = (path: string, kept: readonly string[]) =>
  `kept      ${path}: ${kept.join(', ')} changed in Atlas and in Notion since the last import; Atlas's kept`;

/** The lines one page gets: what became of it, then anything else about it. An unchanged page gets a line only for what it says. */
function pageLines(outcome: PageOutcome): string[] {
  if (outcome.kind === 'refused') return [`refused   ${named(outcome)}: ${outcome.reason}`];
  if (outcome.kind === 'deleted') {
    return [
      `deleted   ${named(outcome)}: imported before and deleted in Atlas, so not made again (--recreate-deleted brings it back)`,
    ];
  }
  const notes = outcome.notes.map((note) => `note      ${outcome.path}: ${note}`);
  const kept =
    outcome.kind === 'create' || outcome.kept.length === 0
      ? []
      : [keptLine(outcome.path, outcome.kept)];
  switch (outcome.kind) {
    case 'create':
      return [`${outcome.written ? 'created  ' : 'would create'} ${outcome.path}`, ...notes];
    case 'update':
      return [
        outcome.filled
          ? `${outcome.written ? 'filled   ' : 'would fill  '} ${outcome.path}: ${outcome.changed.join(', ')} (no record of an earlier import, so only what it lacked)`
          : `${outcome.written ? 'updated  ' : 'would update'} ${outcome.path}: ${outcome.changed.join(', ')}`,
        ...kept,
        ...notes,
      ];
    case 'unchanged':
      return [...kept, ...notes];
  }
}

const count = (outcomes: readonly PageOutcome[], kind: PageOutcome['kind']) =>
  outcomes.filter((outcome) => outcome.kind === kind).length;

const keptCount = (outcomes: readonly PageOutcome[]) =>
  outcomes.filter((outcome) => 'kept' in outcome && outcome.kept.length > 0).length;

function totals(outcome: WorkspaceOutcome): string {
  const { pages } = outcome;
  const [create, update] = outcome.dryRun ? ['to create', 'to update'] : ['created', 'updated'];
  return [
    `${pages.length} pages: ${count(pages, 'create')} ${create}`,
    `${count(pages, 'update')} ${update}`,
    `${count(pages, 'unchanged')} unchanged`,
    `${count(pages, 'refused')} refused`,
    `${keptCount(pages)} with Atlas's edits kept`,
    `${count(pages, 'deleted')} deleted in Atlas`,
    `${outcome.skipped.length} skipped`,
    `${outcome.otherFiles} attachments not brought in`,
  ].join(', ');
}

/** The report: a line for every page that changed, was refused or kept an edit; what was skipped; the meetings; the totals. */
export function workspaceReportLines(outcome: WorkspaceOutcome): string[] {
  const lines = [
    ...(outcome.dryRun ? ['dry run: nothing was written'] : []),
    ...outcome.warnings.map((warning) => `warning   ${warning}`),
    ...(outcome.recordProblem === null
      ? []
      : [`stopped   ${outcome.recordProblem}: the notes listed as written were, and no others`]),
    ...outcome.pages.flatMap(pageLines),
    ...outcome.skipped.map(({ what, reason }) => `skipped   ${what}: ${reason}`),
  ];
  const meetings =
    outcome.meetings === null ? [] : ['Meeting notes:', ...reportLines(outcome.meetings)];
  return [...lines, ...meetings, totals(outcome)];
}

/**
 * Whether the run brought everything in: no page refused, no edit in Atlas
 * kept over a change in Notion (each wants a look), the record kept, and
 * every meeting with a Source ID in the vault. Skipped pages, notes, notes
 * deleted in Atlas and warnings do not count against it.
 */
export const workspaceImported = (outcome: WorkspaceOutcome): boolean =>
  count(outcome.pages, 'refused') === 0 &&
  keptCount(outcome.pages) === 0 &&
  outcome.recordProblem === null &&
  (outcome.meetings === null || allImported(outcome.meetings));

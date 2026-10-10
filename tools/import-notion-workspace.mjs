// Brings a Notion workspace export into a vault (issue #79; setup in
// tools/notion-import/README.md):
//
//   node tools/import-notion-workspace.mjs --export <unzipped export folder> --vault <vault folder>
//     [--dry-run] [--recreate-deleted] [--no-fill-unrecorded] [--only tasks,notes,meetings,people,para,teams,daily]
//     [--task-status "Later=longterm"]… [--gemini-dates arrival-local] [--time-zone <IANA zone>]
//
// Prints what became of every page; exits 1 when a page was refused, an edit
// made in Atlas was kept over Notion's, or a meeting was held or refused, and
// 2 when it could not run at all.
import './n8n/ts-hooks.mjs';
import { parseArgs } from 'node:util';

const { importNotionWorkspace } = await import('./notion-import/import-notion-workspace.ts');
const { workspaceImported, workspaceReportLines } =
  await import('./notion-import/workspace-report.ts');
const { DATABASE_KINDS } = await import('./notion-import/workspace-databases.ts');
const { GEMINI_DATES } = await import('./notion-import/gemini-dates.ts');

const USAGE =
  'usage: node tools/import-notion-workspace.mjs --export <folder> --vault <vault> [--dry-run] [--recreate-deleted] [--no-fill-unrecorded] [--only tasks,notes,meetings,people,para,teams,daily] [--task-status "<Notion status>=<status>"]… [--gemini-dates arrival-local] [--time-zone <IANA zone>|none]';

/** A value the command was given: an empty one (an unset shell variable) is no value at all. */
const given = (value) => (value === undefined || value.trim() === '' ? null : value);

/** The --only list; null when not given, which is every database. */
function only(list) {
  if (list === undefined) return null;
  const named = list
    .split(',')
    .map((each) => each.trim().toLowerCase())
    .filter(Boolean);
  const unknown = named.filter((each) => !DATABASE_KINDS.includes(each));
  if (named.length === 0 || unknown.length > 0) {
    throw new Error(`--only: name databases from ${DATABASE_KINDS.join(', ')}`);
  }
  return named;
}

/** Today on this Mac's clock, as `YYYY-MM-DD`: the day a finished task is completed on. */
function today() {
  const now = new Date();
  const two = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

function options() {
  const { values } = parseArgs({
    options: {
      export: { type: 'string' },
      vault: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'recreate-deleted': { type: 'boolean', default: false },
      'no-fill-unrecorded': { type: 'boolean', default: false },
      only: { type: 'string' },
      'task-status': { type: 'string', multiple: true, default: [] },
      'gemini-dates': { type: 'string' },
      'time-zone': { type: 'string', default: 'America/Los_Angeles' },
    },
  });
  const [exportDir, vault] = [given(values.export), given(values.vault)];
  if (exportDir === null || vault === null) return null;
  const geminiDates = values['gemini-dates'];
  if (geminiDates !== undefined && !GEMINI_DATES.includes(geminiDates)) {
    throw new Error(`--gemini-dates: "${geminiDates}" is not one of ${GEMINI_DATES.join(', ')}`);
  }
  return {
    exportDir,
    vault,
    dryRun: values['dry-run'],
    recreateDeleted: values['recreate-deleted'],
    fillUnrecorded: !values['no-fill-unrecorded'],
    only: only(values.only),
    taskStatuses: values['task-status'],
    today: today(),
    timeZone: values['time-zone'] === 'none' ? null : values['time-zone'],
    ...(geminiDates === undefined ? {} : { geminiDates }),
  };
}

let chosen;
try {
  chosen = options();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
}
if (chosen === undefined || chosen === null) {
  console.error(USAGE);
  process.exit(2);
}

try {
  const outcome = await importNotionWorkspace(chosen);
  for (const line of workspaceReportLines(outcome)) console.log(line);
  process.exit(workspaceImported(outcome) ? 0 : 1);
} catch (error) {
  console.error(`cannot import: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

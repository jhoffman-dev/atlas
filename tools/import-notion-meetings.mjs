// One-time import of a Notion Meeting Notes export into a vault, as meeting
// import contract v1 files (P28-07; setup in tools/n8n/README.md):
//
//   node tools/import-notion-meetings.mjs --csv <export>/<Meeting Notes …_all.csv> \
//     --vault <vault folder> [--folder Inbox/Meetings] [--time-zone America/Los_Angeles]
//     [--group-address leads@example.com …] [--providers granola]
//     [--gemini-dates arrival-local]
//
// Gemini's rows are held until --gemini-dates says how to read their Dates
// (issue #44). Prints what became of every row; exits 1 when a row with a
// Source ID was held or refused, 2 when it could not run at all.
import './n8n/ts-hooks.mjs';
import { parseArgs } from 'node:util';

const { importNotionMeetings } = await import('./notion-import/import-notion-meetings.ts');
const { allImported, reportLines } = await import('./notion-import/import-report.ts');
const { GEMINI_DATES } = await import('./notion-import/gemini-dates.ts');

const USAGE =
  'usage: node tools/import-notion-meetings.mjs --csv <export.csv> --vault <vault> [--folder Inbox/Meetings] [--time-zone <IANA zone>|none] [--group-address <address>]… [--providers gemini,granola] [--gemini-dates arrival-local]';

/** A value the command was given: an empty one (an unset shell variable) is no value at all. */
const given = (value) => (value === undefined || value.trim() === '' ? null : value);

/** The --providers list, lower case; undefined when not given. */
function providers(list) {
  if (list === undefined) return undefined;
  const named = list
    .split(',')
    .map((each) => each.trim().toLowerCase())
    .filter(Boolean);
  if (named.length === 0) throw new Error('--providers: name at least one provider');
  return named;
}

function options() {
  const { values } = parseArgs({
    options: {
      csv: { type: 'string' },
      vault: { type: 'string' },
      folder: { type: 'string', default: 'Inbox/Meetings' },
      'time-zone': { type: 'string', default: 'America/Los_Angeles' },
      'group-address': { type: 'string', multiple: true, default: [] },
      providers: { type: 'string' },
      'gemini-dates': { type: 'string' },
    },
  });
  const [csv, vault, folder] = [given(values.csv), given(values.vault), given(values.folder)];
  if (csv === null || vault === null || folder === null) return null;
  const geminiDates = values['gemini-dates'];
  if (geminiDates !== undefined && !GEMINI_DATES.includes(geminiDates)) {
    throw new Error(`--gemini-dates: "${geminiDates}" is not one of ${GEMINI_DATES.join(', ')}`);
  }
  const zone = values['time-zone'];
  return {
    csv,
    vault,
    folder,
    timeZone: zone === 'none' ? null : zone,
    groupAddresses: values['group-address'],
    ...(values.providers === undefined ? {} : { providers: providers(values.providers) }),
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
  const outcomes = await importNotionMeetings(chosen);
  for (const line of reportLines(outcomes)) console.log(line);
  process.exit(allImported(outcomes) ? 0 : 1);
} catch (error) {
  console.error(`cannot import: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

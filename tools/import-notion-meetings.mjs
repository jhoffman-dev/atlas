// One-time import of a Notion Meeting Notes export into a vault, as meeting
// import contract v1 files (P28-07; setup in tools/n8n/README.md):
//
//   node tools/import-notion-meetings.mjs --csv <export>/<Meeting Notes …_all.csv> \
//     --vault <vault folder> [--folder Inbox/Meetings] [--time-zone America/Los_Angeles]
//     [--group-address leads@example.com …]
//
// Prints what became of every row; exits 1 when a row with a Source ID was
// not brought in, 2 when it could not run at all.
import './n8n/ts-hooks.mjs';
import { parseArgs } from 'node:util';

const { importNotionMeetings } = await import('./notion-import/import-notion-meetings.ts');
const { allImported, reportLines } = await import('./notion-import/import-report.ts');

const USAGE =
  'usage: node tools/import-notion-meetings.mjs --csv <export.csv> --vault <vault> [--folder Inbox/Meetings] [--time-zone <IANA zone>|none] [--group-address <address>]…';

function options() {
  const { values } = parseArgs({
    options: {
      csv: { type: 'string' },
      vault: { type: 'string' },
      folder: { type: 'string', default: 'Inbox/Meetings' },
      'time-zone': { type: 'string', default: 'America/Los_Angeles' },
      'group-address': { type: 'string', multiple: true, default: [] },
    },
  });
  if (values.csv === undefined || values.vault === undefined) return null;
  const zone = values['time-zone'];
  return {
    csv: values.csv,
    vault: values.vault,
    folder: values.folder,
    timeZone: zone === 'none' ? null : zone,
    groupAddresses: values['group-address'],
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

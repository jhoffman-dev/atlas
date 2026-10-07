// Checks meeting files against the meeting import contract v1, with the
// validator Atlas runs and the YAML reader it reads every note with:
//
//   node tools/n8n/validate-meeting.mjs <file.md> [more.md …]
//
// Prints each file's problems; exits 1 when any file fails.
import './ts-hooks.mjs';
import { readFileSync } from 'node:fs';

const { validateMeetingImport } = await import('../../packages/domain/src/index.ts');
const { remarkMarkdown } = await import('../../packages/adapters/src/index.ts');

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node tools/n8n/validate-meeting.mjs <file.md> [more.md …]');
  process.exit(2);
}

let failed = 0;
/** The file's text, or null after printing a FAIL line for a file that cannot be read. */
function readMeeting(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    console.log(`FAIL  ${file}`);
    console.log(`      cannot read: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

for (const file of files) {
  const text = readMeeting(file);
  if (text === null) {
    failed += 1;
    continue;
  }
  const result = validateMeetingImport({
    text,
    selfName: null,
    readFrontmatter: (frontmatter) => ({
      properties: remarkMarkdown.frontmatterProperties(frontmatter),
      problem: remarkMarkdown.frontmatterProblem(frontmatter),
    }),
  });
  if (result.ok) {
    console.log(`ok    ${file} (${result.meeting.transcript.length} turns)`);
  } else {
    failed += 1;
    console.log(`FAIL  ${file}`);
    for (const error of result.errors) console.log(`      ${error.field}: ${error.message}`);
  }
}
process.exit(failed === 0 ? 0 : 1);

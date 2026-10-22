import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { describe, expect, it } from 'vitest';
import { compileHighlightsQuery, compileLibraryQuery } from './research-query.ts';

/**
 * The statements the Library and All highlights send the host, written out
 * for the Rust side to run (`src-tauri/src/index.rs`, `research_statements_*`):
 * the real schema, the real authorizer and the real step budget, over a
 * seeded index, with the very text TypeScript compiles. Change a statement
 * and this fails until the file is written again:
 * `UPDATE_RESEARCH_STATEMENTS=1 pnpm vitest run research-statements.golden`.
 */
const GOLDEN = new URL('./research-statements.golden.json', import.meta.url);

const PATHS = ['Library/Ledger.md', 'Library/Verses.md'];

function statements() {
  return {
    library: compileLibraryQuery(),
    libraryOfNotes: compileLibraryQuery({ paths: PATHS }),
    highlights: compileHighlightsQuery(),
    highlightsAfter: compileHighlightsQuery({ after: { path: 'Library/Ledger.md', index: 41 } }),
    highlightsOfNotes: compileHighlightsQuery({ paths: PATHS }),
  };
}

describe('the research statements, as the host runs them', () => {
  it('are the ones the host test runs', async () => {
    // As the repo's formatter writes JSON, so its format check passes on the file.
    const path = fileURLToPath(GOLDEN);
    const written = await format(JSON.stringify(statements()), {
      ...(await resolveConfig(path)),
      parser: 'json',
    });
    if (process.env['UPDATE_RESEARCH_STATEMENTS'] === '1') writeFileSync(path, written);
    expect(readFileSync(GOLDEN, 'utf8')).toBe(written);
  });
});

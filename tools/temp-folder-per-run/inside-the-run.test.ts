import { tmpdir } from 'node:os';
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Run on its own by temp-folder-per-run.test.ts, as a whole Vitest run of its
 * own, and with the rest of the suite too: either way, a test's temp folder is
 * the run's own, which the run removes when it ends (issues #397, #486).
 */
describe('a test in a Vitest run', () => {
  it("has the run's own temp folder", () => {
    expect(basename(tmpdir())).toMatch(/^atlas-test-run-/);
  });
});

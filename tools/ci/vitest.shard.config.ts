import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import whole from '../../vitest.config.ts';

/*
 * The repository's Vitest config, for one shard of the suite in CI
 * (.github/workflows/gate.yml, the `unit` jobs): the same tests and the same
 * coverage, without the thresholds.
 *
 * A share of the tests covers a share of the code, so a shard held to the
 * thresholds always fails them. They are not dropped: the `coverage` job merges
 * the shards' reports under vitest.config.ts itself, thresholds and all.
 */
const coverage = { ...whole.test?.coverage };
delete coverage.thresholds;

export default defineConfig({
  ...whole,
  // Vitest takes its root from the config file's folder, which is not this one's.
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: { ...whole.test, coverage },
});

import { defineConfig, devices } from '@playwright/test';
import e2e from './playwright.config.ts';

/**
 * The app's response times on the 2,000-note fixture vault (#217), with the
 * e2e config's per-checkout port and server, one test at a time so nothing
 * else shares the main thread with the one being timed.
 *
 * - `latency` (`pnpm perf`): timed in WebKit, the engine the app ships in, and
 *   held to the budgets. This is what CI runs.
 * - `profile` (`pnpm perf:profile`): the same actions under Chromium's CPU
 *   profiler, which WebKit lacks, to name where the time went.
 */
export default defineConfig({
  ...e2e,
  testDir: './tools/perf',
  fullyParallel: false,
  workers: 1,
  projects: [
    { name: 'latency', testMatch: 'ui-latency.spec.ts', use: { ...devices['Desktop Safari'] } },
    { name: 'profile', testMatch: 'profile.spec.ts', use: { ...devices['Desktop Chrome'] } },
  ],
});

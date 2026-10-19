import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import e2e from './playwright.config.ts';

/**
 * `pnpm shots:gallery`: the primitives gallery (apps/desktop/gallery.html)
 * screenshotted in both themes, for judging a slice of the UI v2 plan against
 * the components strip of design/target/Tokens.dc.html. The gallery is not one
 * of the build's inputs, so it is served by Vite's dev server rather than from
 * `dist` — on a port of its own, a fixed distance above this checkout's e2e
 * port, so two worktrees never share one.
 */
const e2ePort = Number(new URL(e2e.use?.baseURL ?? 'http://localhost:4173').port);
const PORT = e2ePort + 1000;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  ...e2e,
  testDir: './tools/design',
  // The gallery's own shots, and the attack specs that judge it in a real engine.
  testMatch: /\/gallery[^/]*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  use: { ...e2e.use, baseURL: BASE_URL },
  webServer: {
    // Vite's own binary, not a package-manager wrapper, for the same reason as
    // tools/serve-dist.mjs: the wrapper's child outlives Playwright's teardown.
    command: `${join('node_modules', '.bin', 'vite')} --port ${PORT} --strictPort`,
    cwd: join(import.meta.dirname, 'apps', 'desktop'),
    url: `${BASE_URL}/gallery.html`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

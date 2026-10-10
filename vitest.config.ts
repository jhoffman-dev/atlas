import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Before '@atlas/ui', which would otherwise claim it as a path inside its index file.
      // A second entry point so the graph page, loaded lazily, keeps d3-force out of
      // the main bundle: the barrel is imported eagerly and everything it exports lands there.
      '@atlas/ui/graph': fileURLToPath(
        new URL('./packages/ui/src/graph/index.ts', import.meta.url),
      ),
      // Before '@atlas/application', for the same reason: test support that needs
      // node:sqlite, kept out of the barrel the app's browser bundle is built from.
      '@atlas/application/testing/sqlite': fileURLToPath(
        new URL('./packages/application/src/testing/sqlite.ts', import.meta.url),
      ),
      '@atlas/domain': pkg('domain'),
      '@atlas/application': pkg('application'),
      '@atlas/adapters': pkg('adapters'),
      '@atlas/ui': pkg('ui'),
    },
  },
  test: {
    globals: true,
    // Node by default; component tests opt in with `// @vitest-environment jsdom`.
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'packages/*/src/**/*.test.{ts,tsx}',
      'apps/*/src/**/*.test.{ts,tsx}',
      'tools/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'lcov'],
      include: [
        'packages/*/src/**/*.{ts,tsx}',
        'apps/*/src/**/*.{ts,tsx}',
        'tools/n8n/*.ts',
        'tools/notion-import/*.ts',
      ],
      exclude: ['**/*.test.{ts,tsx}', '**/index.ts', '**/*.d.ts'],
      // Repo-wide floor. The high-impact slice named in COVERAGE.md is held higher,
      // with its own threshold added as each module lands.
      thresholds: {
        lines: 70,
        'packages/domain/src/**': { lines: 90, functions: 90, branches: 85 },
        // A refresh writes files into the vault, so it is held to the same bar
        // as the rules it carries out.
        'packages/application/src/sources/**': { lines: 90, functions: 90, branches: 85 },
        // Editing a type rewrites its file, and can rewrite every note of it; setting a
        // vault up for PARA writes type files and adds to the vault's own (P30-01).
        'packages/application/src/types/{edit-types,migrate-notes,load-types,ensure-built-in-types}.ts':
          {
            lines: 90,
            functions: 90,
            branches: 85,
          },
        // The local API writes into the vault on behalf of other programs.
        'packages/application/src/api/**': { lines: 90, functions: 90, branches: 85 },
        // Renaming a tag rewrites every note that uses it.
        'packages/application/src/tags/**': { lines: 90, functions: 90, branches: 85 },
        // Saving an artifact writes a folder of files into the vault.
        'packages/application/src/artifacts/**': { lines: 90, functions: 90, branches: 85 },
        // Archiving moves notes and rewrites their frontmatter (U-22).
        'packages/application/src/archive/**': { lines: 90, functions: 90, branches: 85 },
        // Processing the Inbox moves notes and rewrites their frontmatter (P30-01).
        'packages/application/src/inbox/**': { lines: 90, functions: 90, branches: 85 },
        // Moving tasks to GTD rewrites every task, view and rule naming a status, and undoes it (P30-02).
        'packages/application/src/gtd/**': { lines: 90, functions: 90, branches: 85 },
        // Accepting a proposal writes notes and archives it; undo takes them back (P29-02).
        'packages/application/src/proposals/**': { lines: 90, functions: 90, branches: 85 },
        // A task's schedule is read from the index and answered to the API (P31-01);
        // a drop on the calendar writes a block or links a task into one, and undoes it (P31-02).
        'packages/application/src/timeblocks/**': { lines: 90, functions: 90, branches: 85 },
        // An automation moves and rewrites notes by itself, on a clock (P25).
        'packages/application/src/automations/**': { lines: 90, functions: 90, branches: 85 },
        // A sync merges other Macs' changes into the notes and settles conflicts (U-29).
        'packages/application/src/sync/**': { lines: 90, functions: 90, branches: 85 },
        // Meeting import marks, and archives, files that arrived from outside Atlas (P28-04).
        'packages/application/src/meetings/**': { lines: 90, functions: 90, branches: 85 },
        // Kept work is the only copy of typing the vault never got.
        'apps/desktop/src/notes/*stranded*.ts': { lines: 90, functions: 90, branches: 85 },
        // Carries the API token, and turns every failure into what the model is told.
        'apps/mcp/src/{connection,client}.ts': { lines: 90, functions: 90, branches: 85 },
        // The n8n meeting mapper writes files into the vault from outside it (P28-02).
        'tools/n8n/*.ts': { lines: 90, functions: 90, branches: 85 },
        // Adding a term writes a note; editing one rewrites its frontmatter (P28-05).
        'packages/application/src/terms/**': { lines: 90, functions: 90, branches: 85 },
        // The Notion meeting import writes a history of meetings into a vault (P28-07).
        'tools/notion-import/*.ts': { lines: 90, functions: 90, branches: 85 },
      },
    },
  },
});

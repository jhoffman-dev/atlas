import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const pkg = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

/**
 * The markdown reader's table of HTML entities, by file. Left to the bundler,
 * a browser build gets the other one the package ships, which asks `document`
 * to decode each entity — and the index reads notes in a worker (#135), where
 * there is no `document`: the worker died as it loaded. Found through the
 * adapters' own dependency on the reader, since this package does not have one.
 */
const fromAdapters = createRequire(
  new URL('../../packages/adapters/package.json', import.meta.url),
);
const entityTable = createRequire(fromAdapters.resolve('micromark-util-decode-string')).resolve(
  'decode-named-character-reference',
);

/**
 * Writes where each chunk loaded on first use landed into index.html, by the
 * chunk's name, for `src/chunk-files.ts`: a chunk that failed to parse or run
 * can then be imported again under a fresh address. A meta tag, not a script,
 * since it is only data.
 */
function chunkFilesMeta(): Plugin {
  return {
    name: 'atlas-chunk-files',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (_html, context) => {
        const files = Object.values(context.bundle ?? {}).flatMap((output) =>
          output.type === 'chunk' && output.isDynamicEntry ? [[output.name, output.fileName]] : [],
        );
        return [
          {
            tag: 'meta',
            attrs: { name: 'atlas-chunks', content: JSON.stringify(Object.fromEntries(files)) },
            injectTo: 'head',
          },
        ];
      },
    },
  };
}

/**
 * The commit this build is made from, short, for Settings → About and the
 * API's status (#481). Null outside a git checkout — a build from a source
 * archive — which the app shows as no build rather than failing to build.
 */
function buildCommit(): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // No git, or not a checkout: the build simply does not know its commit.
    return null;
  }
}

export default defineConfig({
  plugins: [react(), chunkFilesMeta()],
  // The MCP server's path in this checkout, so Settings can offer a command that
  // runs it. Only right for a build made from source, which is how DFAI is run.
  define: {
    __ATLAS_MCP_ENTRY__: JSON.stringify(
      fileURLToPath(new URL('../mcp/dist/main.js', import.meta.url)),
    ),
    __ATLAS_BUILD__: JSON.stringify(buildCommit()),
  },
  resolve: {
    alias: {
      // Before '@dfai/ui', which would otherwise claim it as a path inside its index file.
      // A second entry point so the graph page, loaded lazily, keeps d3-force out of
      // the main bundle: the barrel is imported eagerly and everything it exports lands there.
      '@dfai/ui/graph': fileURLToPath(
        new URL('../../packages/ui/src/graph/index.ts', import.meta.url),
      ),
      // The same reader on the window's thread and in the worker, so both read a note alike.
      'decode-named-character-reference': entityTable,
      '@dfai/domain': pkg('domain'),
      '@dfai/application': pkg('application'),
      '@dfai/adapters': pkg('adapters'),
      '@dfai/ui': pkg('ui'),
    },
  },
  // Tauri drives the dev server, so the port is fixed and failures must be loud.
  server: { port: 1420, strictPort: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'safari17',
    // Everything start-up loads in one chunk. Left alone, the bundler splits the code
    // the main chunk shares with a page loaded on first use (`pages-on-first-use.ts`)
    // into chunks of their own, which start-up then fetches anyway, compressed worse.
    // The pages can leave the main chunk at all because @dfai/ui declares no side
    // effects: its index file then no longer keeps every page it exports there.
    rolldownOptions: {
      output: { codeSplitting: { groups: [{ name: 'start', tags: ['$initial'] }] } },
    },
  },
  clearScreen: false,
});

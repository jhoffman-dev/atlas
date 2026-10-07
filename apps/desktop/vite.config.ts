import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const pkg = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  // The MCP server's path in this checkout, so Settings can offer a command that
  // runs it. Only right for a build made from source, which is how Atlas is run.
  define: {
    __ATLAS_MCP_ENTRY__: JSON.stringify(
      fileURLToPath(new URL('../mcp/dist/main.js', import.meta.url)),
    ),
  },
  resolve: {
    alias: {
      // Before '@atlas/ui', which would otherwise claim it as a path inside its index file.
      // A second entry point so the graph page, loaded lazily, keeps d3-force out of
      // the main bundle: the barrel is imported eagerly and everything it exports lands there.
      '@atlas/ui/graph': fileURLToPath(
        new URL('../../packages/ui/src/graph/index.ts', import.meta.url),
      ),
      '@atlas/domain': pkg('domain'),
      '@atlas/application': pkg('application'),
      '@atlas/adapters': pkg('adapters'),
      '@atlas/ui': pkg('ui'),
    },
  },
  // Tauri drives the dev server, so the port is fixed and failures must be loud.
  server: { port: 1420, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, target: 'safari17' },
  clearScreen: false,
});

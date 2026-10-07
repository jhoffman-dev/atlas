/**
 * Entry point: `node dist/main.js`, started by an MCP client over stdio.
 *
 * stdout carries the protocol and nothing else; anything for a person goes to
 * stderr.
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { AtlasClient } from './client.ts';
import { resolveConnection } from './connection.ts';
import { createAtlasServer } from './server.ts';

const client = new AtlasClient({
  connect: () =>
    resolveConnection({
      env: process.env,
      platform: process.platform,
      homeDir: homedir(),
      readFile: (path) => readFile(path, 'utf8'),
    }),
});

serveStdio(() => createAtlasServer(client), {
  onerror: (error) => console.error('atlas-mcp:', error.message),
});

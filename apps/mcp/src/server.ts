/** The MCP server: every Atlas tool, bound to one client. */

import { McpServer } from '@modelcontextprotocol/server';
import type { AtlasClient } from './client.ts';
import { archiveTools } from './tools/archive.ts';
import { artifactTools } from './tools/artifacts.ts';
import { automationTools } from './tools/automations.ts';
import { captureTools } from './tools/capture.ts';
import { imageTools } from './tools/images.ts';
import { meetingTools } from './tools/meetings.ts';
import { noteTools } from './tools/notes.ts';
import { queryTools } from './tools/queries.ts';
import { sourceTools } from './tools/sources.ts';
import { tagTools } from './tools/tags.ts';
import { templateTools } from './tools/templates.ts';
import { vaultTools } from './tools/vault.ts';
import { viewTools } from './tools/views.ts';

export const SERVER_NAME = 'atlas';
export const SERVER_VERSION = '0.1.0';

export const ATLAS_TOOLS = [
  ...vaultTools,
  ...noteTools,
  ...queryTools,
  ...viewTools,
  ...captureTools,
  ...artifactTools,
  ...imageTools,
  ...sourceTools,
  ...tagTools,
  ...templateTools,
  ...archiveTools,
  ...automationTools,
  ...meetingTools,
];

const INSTRUCTIONS =
  'Atlas is a local notes app; these tools read and write its vault while it is running. ' +
  'Notes are named by vault-relative paths with ".md". Read a note before changing it and pass ' +
  'its "modified" back as "ifModified". Call atlas_list_types before creating typed notes or ' +
  'querying, so property keys and values are real ones.';

export function createAtlasServer(client: AtlasClient): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );
  for (const tool of ATLAS_TOOLS) tool.register(server, client);
  return server;
}

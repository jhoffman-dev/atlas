/** Refreshing a source note: `/v1/sources/{path}/refresh`. */

import { z } from 'zod';
import { defineTool } from './define.ts';

export const refreshSource = defineTool({
  name: 'atlas_refresh_source',
  title: 'Refresh a source',
  description:
    'Refresh a source note now, as its Refresh button in Atlas does: read its feed or file and ' +
    'write each record into its folder as a note. A source that names a secret has it filled in ' +
    'by Atlas and sent only to the sites it was set for in Settings; no tool can read a secret. ' +
    'Returns { report: { ran, from, records, created, replaced, updated, missing, unkeyed, ' +
    'truncated, error } }; "error" says why a refresh failed, which is not a tool error. Fails ' +
    'with "conflict" when that source is being refreshed already.',
  inputSchema: z.object({
    path: z
      .string()
      .min(1)
      .describe(
        'Vault-relative path of the source note, with ".md" — usually in .atlas/sources, e.g. ' +
          '".atlas/sources/Issues.md". Find them with atlas_sql on files where path LIKE ' +
          "'.atlas/sources/%'.",
      ),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  call: (client, { path }) => client.refreshSource(path),
});

export const sourceTools = [refreshSource];

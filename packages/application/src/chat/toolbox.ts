import type { ModelToolSpec, ToolCall, ToolResult } from '@atlas/domain';
import type { ApiRouterDeps } from '../api/index.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { listVaultNotes } from '../vault/read-vault.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { proposeEdit, proposeNote, ProposalRefused, type Proposal } from './proposals.ts';
import { READ_TOOL_SPECS, isReadTool, runReadTool } from './read-tools.ts';

/** What running one tool call came to: the model's result, and a proposal to show, if any. */
export interface ToolOutcome {
  readonly result: ToolResult;
  readonly proposal: Proposal | null;
}

/** The tools a chat may call, and how each call is run. */
export interface ChatToolbox {
  readonly specs: readonly ModelToolSpec[];
  run(call: ToolCall): Promise<ToolOutcome>;
}

const PROPOSED =
  'Shown to the person as a proposed change. It is not written unless they accept it; ' +
  'do not say it was made.';

const PROPOSAL_SPECS: readonly ModelToolSpec[] = [
  {
    name: 'propose_edit',
    description:
      'Propose a change to one note, for the person to accept or reject. "edits" are exact spans ' +
      'of the body as atlas_read_note returned it, each found exactly once, and what each becomes; ' +
      '"append" adds markdown at the end; "properties" sets frontmatter values (null removes one). ' +
      'Read the note first. ' +
      PROPOSED,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: "The note's vault path." },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: { find: { type: 'string' }, replace: { type: 'string' } },
            required: ['find', 'replace'],
          },
        },
        append: { type: 'string' },
        properties: { type: 'object' },
      },
      required: ['path'],
    },
  },
  {
    name: 'propose_note',
    description: `Propose a new note, for the person to accept or reject. ${PROPOSED}`,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Its name.' },
        folder: { type: 'string', description: 'Vault-relative folder. Omit for the default.' },
        body: { type: 'string', description: 'Its markdown body.' },
        properties: { type: 'object' },
      },
      required: ['title'],
    },
  },
];

/**
 * The chat's tools: the read routes of the local API, answered in-process,
 * and the two proposals, which only ever describe a change.
 */
export function createChatToolbox({
  api,
  fs,
  markdown,
  newId,
}: {
  api: ApiRouterDeps;
  /** Bound to the vault the chat is in. */
  fs: VaultFsPort;
  markdown: MarkdownPort;
  newId: () => string;
}): ChatToolbox {
  return {
    specs: [...READ_TOOL_SPECS, ...PROPOSAL_SPECS],
    async run(call) {
      if (isReadTool(call.name)) {
        return {
          result: await runReadTool({ call, api, requestId: `chat-${newId()}` }),
          proposal: null,
        };
      }
      try {
        const proposal =
          call.name === 'propose_edit'
            ? await proposeEdit({ fs, markdown, input: call.input, id: newId() })
            : call.name === 'propose_note'
              ? proposeNote({
                  markdown,
                  input: call.input,
                  id: newId(),
                  notePaths: await listVaultNotes({ fs }),
                })
              : null;
        if (proposal === null) return failed(call, `There is no tool "${call.name}".`);
        return {
          result: { callId: call.id, name: call.name, content: PROPOSED, isError: false },
          proposal,
        };
      } catch (error) {
        if (error instanceof ProposalRefused) return failed(call, error.message);
        throw error;
      }
    },
  };
}

function failed(call: ToolCall, content: string): ToolOutcome {
  return { result: { callId: call.id, name: call.name, content, isError: true }, proposal: null };
}

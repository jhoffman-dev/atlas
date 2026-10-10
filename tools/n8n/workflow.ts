import { MAP_MEETING_NODE } from './code-node.ts';

/** The vault's sync repository, which Atlas pulls every minute (ADR-0025). */
export const VAULT_REPO = { owner: 'jhoffman-dev', repository: 'pkm-space' } as const;

/**
 * The n8n credential the GitHub nodes use, by name only: the token lives in
 * n8n's credential store, never in this file.
 */
export const GITHUB_CREDENTIAL = 'GitHub pkm-space (contents)';

export const NODES = {
  fields: 'Meeting fields for Atlas',
  map: MAP_MEETING_NODE,
  getPath: 'Is the path taken?',
  same: 'Same meeting?',
  ifSame: 'Already in the vault?',
  getCollision: 'Is the other path taken?',
  sameOther: 'Same meeting at the other path?',
  create: 'Commit meeting file',
  createCollision: 'Commit meeting file (other path)',
  skip: 'Skip: already in the vault',
  failed: 'Atlas commit failed',
} as const;

/**
 * The node in James's workflow that parses the email, by name. The Atlas
 * branch is wired from the Notion node's success output, where `$json` is
 * Notion's page, so the fields are read from the parse step by name (paired
 * items carry each meeting through the Notion node). James renames his parse
 * step to this, or edits the name in the expressions.
 */
export const PARSE_NODE = 'Parse meeting email';

const parsed = (field: string) => `$('${PARSE_NODE}').item.json["${field}"]`;
const text = (field: string) => `={{ ${parsed(field)} }}`;
/** A field that may come as text or as a list of lines, as text either way. */
const lines = (field: string) => `={{ [].concat(${parsed(field)} ?? []).join("\\n") }}`;

/** The fields the mapper reads, each from the parse step's output. Edit the right-hand sides. */
const FIELD_SOURCES: readonly (readonly [string, string])[] = [
  ['title', text('Meeting name')],
  ['date', text('Date')],
  ['start', text('Start')],
  ['end', text('End')],
  // The Gemini email's subject states the meeting's day; its arrival, less the
  // transcript's length, the start. The Notion Date is when the notes arrived.
  ['stated', text('Subject')],
  ['arrived', text('Received')],
  ['attendees', lines('Attendees')],
  ['summary', text('Summary')],
  ['decisions', text('Decisions')],
  ['nextSteps', lines('Next steps')],
  ['details', text('Details')],
  ['transcript', lines('Transcript')],
  ['category', text('Category')],
  ['source', text('Source')],
  ['sourceId', text('Source ID')],
];

/** Failures leave by the node's second output (to "Atlas commit failed") instead of stopping the run. */
const ERROR_OUTPUT = { onError: 'continueErrorOutput' } as const;

const locator = (value: string) => ({ __rl: true, value, mode: 'name' });
const mapped = (field: string) => `={{ $('${MAP_MEETING_NODE}').item.json.${field} }}`;

function githubNode(
  name: string,
  { id, position, parameters }: { id: string; position: [number, number]; parameters: object },
) {
  return {
    id,
    name,
    type: 'n8n-nodes-base.github',
    typeVersion: 1.1,
    position,
    parameters: {
      resource: 'file',
      owner: locator(VAULT_REPO.owner),
      repository: locator(VAULT_REPO.repository),
      ...parameters,
    },
    credentials: { githubApi: { name: GITHUB_CREDENTIAL } },
  };
}

/** Fetch the file at `path`; "not found" leaves by the error output, meaning the path is free. */
const fileLookup = (name: string, id: string, path: string, position: [number, number]) => ({
  ...githubNode(name, {
    id,
    position,
    parameters: {
      operation: 'get',
      filePath: path,
      asBinaryProperty: false,
      additionalParameters: {},
    },
  }),
  onError: 'continueErrorOutput',
});

/** Commit a new file at `path` on the default branch. A failure goes to "Atlas commit failed". */
const fileCreate = (name: string, id: string, path: string, position: [number, number]) => ({
  ...githubNode(name, {
    id,
    position,
    parameters: {
      operation: 'create',
      filePath: path,
      fileContent: mapped('content'),
      commitMessage: mapped('commitMessage'),
      additionalParameters: {},
    },
  }),
  ...ERROR_OUTPUT,
});

function fieldsNode() {
  return {
    id: 'a7c0e5b1-0001-4c1d-9e57-5f1b2c3d4e01',
    name: NODES.fields,
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position: [0, 0],
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: FIELD_SOURCES.map(([name, value], index) => ({
          id: `a7c0e5b1-f${String(index).padStart(3, '0')}-4c1d-9e57-5f1b2c3d4e01`,
          name,
          value,
          type: 'string',
        })),
      },
      includeOtherFields: false,
      options: {},
    },
    ...ERROR_OUTPUT,
  };
}

function codeNode(name: string, id: string, jsCode: string, position: [number, number]) {
  return {
    id,
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
    parameters: { mode: 'runOnceForEachItem', jsCode },
    ...ERROR_OUTPUT,
  };
}

/** A node that does nothing, where a branch ends; James can hang a notification off it. */
function endNode(name: string, id: string, position: [number, number]) {
  return { id, name, type: 'n8n-nodes-base.noOp', typeVersion: 1, position, parameters: {} };
}

function ifSameNode() {
  return {
    id: 'a7c0e5b1-0005-4c1d-9e57-5f1b2c3d4e01',
    name: NODES.ifSame,
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [880, -120],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            id: 'a7c0e5b1-c001-4c1d-9e57-5f1b2c3d4e01',
            leftValue: '={{ $json.duplicate }}',
            rightValue: '',
            operator: { type: 'boolean', operation: 'true', singleValue: true },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
  };
}

const to = (...names: string[]) => names.map((node) => ({ node, type: 'main', index: 0 }));

/**
 * The nodes to paste after the Notion node, with the mapper's scripts in
 * them. Idempotent: a meeting already at its path, or at its own collision
 * path, is skipped; a different meeting at its path sends it to the
 * collision path; only a free path is written. Nothing in it stops the run:
 * every failure — a refused meeting, a file it cannot read, both paths taken
 * by others, a failed commit — goes to "Atlas commit failed".
 */
export function meetingWorkflow(scripts: { map: string; same: string; sameOther: string }) {
  return {
    name: 'Meeting to Atlas (commit to pkm-space)',
    nodes: [
      fieldsNode(),
      codeNode(NODES.map, 'a7c0e5b1-0002-4c1d-9e57-5f1b2c3d4e01', scripts.map, [220, 0]),
      fileLookup(NODES.getPath, 'a7c0e5b1-0003-4c1d-9e57-5f1b2c3d4e01', mapped('path'), [440, 0]),
      codeNode(NODES.same, 'a7c0e5b1-0004-4c1d-9e57-5f1b2c3d4e01', scripts.same, [660, -120]),
      ifSameNode(),
      fileLookup(
        NODES.getCollision,
        'a7c0e5b1-0006-4c1d-9e57-5f1b2c3d4e01',
        mapped('collisionPath'),
        [1100, -40],
      ),
      codeNode(
        NODES.sameOther,
        'a7c0e5b1-000a-4c1d-9e57-5f1b2c3d4e01',
        scripts.sameOther,
        [1320, -120],
      ),
      fileCreate(NODES.create, 'a7c0e5b1-0007-4c1d-9e57-5f1b2c3d4e01', mapped('path'), [660, 120]),
      fileCreate(
        NODES.createCollision,
        'a7c0e5b1-0008-4c1d-9e57-5f1b2c3d4e01',
        mapped('collisionPath'),
        [1320, 40],
      ),
      endNode(NODES.skip, 'a7c0e5b1-0009-4c1d-9e57-5f1b2c3d4e01', [1540, -200]),
      endNode(NODES.failed, 'a7c0e5b1-000b-4c1d-9e57-5f1b2c3d4e01', [1540, 240]),
    ],
    connections: {
      [NODES.fields]: { main: [to(NODES.map), to(NODES.failed)] },
      [NODES.map]: { main: [to(NODES.getPath), to(NODES.failed)] },
      [NODES.getPath]: { main: [to(NODES.same), to(NODES.create)] },
      [NODES.same]: { main: [to(NODES.ifSame), to(NODES.failed)] },
      [NODES.ifSame]: { main: [to(NODES.skip), to(NODES.getCollision)] },
      [NODES.getCollision]: { main: [to(NODES.sameOther), to(NODES.createCollision)] },
      [NODES.sameOther]: { main: [to(NODES.skip), to(NODES.failed)] },
      [NODES.create]: { main: [[], to(NODES.failed)] },
      [NODES.createCollision]: { main: [[], to(NODES.failed)] },
    },
    settings: { executionOrder: 'v1' },
  };
}

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
  notify: 'Email me: meeting not in Atlas',
} as const;

/**
 * Where the Atlas branch reads a meeting in your workflow, by node name, so
 * a field reads the same whichever node's output the branch hangs off
 * (paired items carry each meeting through).
 */
export interface MeetingSources {
  /**
   * The node whose output is the assembled meeting, before any Notion step
   * (the People lookups and creates): `title`, `attendees`
   * (`[{ name, email }]`), `summaryMd`, `transcriptMd`, `source`, `sourceId`,
   * `category`. The branch is wired from this node too, so a Notion failure,
   * or a meeting with no people, cannot keep it from running. Its date is
   * when the notes arrived, so it is not read.
   */
  readonly meetingNode: string;
  /** The node whose output is the notes email itself, for its subject and arrival. */
  readonly emailNode: string;
  /** The email's subject field, which states the meeting's day (and time, if any). */
  readonly subjectField: string;
  /** The email's arrival field: an instant, the fallback for an approximate start. */
  readonly arrivedField: string;
}

/** Example names: a Gmail trigger's own fields are `subject` and `date`. Edit them to yours. */
export const EXAMPLE_SOURCES: MeetingSources = {
  meetingNode: 'Assembled meeting',
  emailNode: 'Notes email',
  subjectField: 'subject',
  arrivedField: 'date',
};

/** Where "Atlas commit failed" sends its email. A placeholder: put your own address in. */
export const NOTIFY_TO = 'you@example.com';

/** The n8n Gmail credential the notification sends with, by name. */
export const GMAIL_CREDENTIAL = 'Gmail account';

const read = (node: string, field: string) => `$('${node}').item.json["${field}"]`;

interface FieldRow {
  readonly name: string;
  readonly value: string;
  readonly type: 'string' | 'array';
}

/** The fields the mapper reads, each from your workflow's nodes by name. */
export function fieldRows(sources: MeetingSources): readonly FieldRow[] {
  const meeting = (field: string) => `={{ ${read(sources.meetingNode, field)} }}`;
  const email = (field: string) => `={{ ${read(sources.emailNode, field)} }}`;
  const text = (name: string, value: string): FieldRow => ({ name, value, type: 'string' });
  return [
    text('title', meeting('title')),
    // The email's subject states the meeting's day; its arrival, less the
    // transcript's length, the start. Never the meeting item's date: that is the arrival.
    text('stated', email(sources.subjectField)),
    text('arrived', email(sources.arrivedField)),
    { name: 'attendees', value: meeting('attendees'), type: 'array' },
    text('sections', meeting('summaryMd')),
    text('transcript', meeting('transcriptMd')),
    text('category', meeting('category')),
    text('source', meeting('source')),
    text('sourceId', meeting('sourceId')),
  ];
}

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

function fieldsNode(sources: MeetingSources) {
  return {
    id: 'a7c0e5b1-0001-4c1d-9e57-5f1b2c3d4e01',
    name: NODES.fields,
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position: [0, 0],
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: fieldRows(sources).map(({ name, value, type }, index) => ({
          id: `a7c0e5b1-f${String(index).padStart(3, '0')}-4c1d-9e57-5f1b2c3d4e01`,
          name,
          value,
          type,
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

/** A node that does nothing, where a branch ends. */
function endNode(name: string, id: string, position: [number, number]) {
  return { id, name, type: 'n8n-nodes-base.noOp', typeVersion: 1, position, parameters: {} };
}

/** What went wrong, as the failing node's error output carries it. */
const WHY =
  '{{ typeof $json.error === "string" ? $json.error : JSON.stringify($json.error ?? $json) }}';

/**
 * An email to you when a meeting did not reach Atlas. It says nothing of
 * Notion: Atlas runs first, so Notion may not have the meeting yet. A
 * notification that cannot be sent stops nothing.
 */
function notifyNode(sources: MeetingSources) {
  const meeting = (field: string) => `{{ ${read(sources.meetingNode, field)} }}`;
  return {
    id: 'a7c0e5b1-000c-4c1d-9e57-5f1b2c3d4e01',
    name: NODES.notify,
    type: 'n8n-nodes-base.gmail',
    typeVersion: 2.1,
    position: [1760, 240],
    parameters: {
      resource: 'message',
      operation: 'send',
      sendTo: NOTIFY_TO,
      subject: `=Atlas did not get a meeting: ${meeting('title')}`,
      emailType: 'text',
      message: [
        `=This meeting was not committed to the Atlas vault: ${WHY}`,
        '',
        `Meeting: ${meeting('title')}`,
        `Source ID: ${meeting('sourceId')}`,
        'Execution: {{ $workflow.name }} #{{ $execution.id }}',
      ].join('\n'),
      options: { appendAttribution: false },
    },
    credentials: { gmailOAuth2: { name: GMAIL_CREDENTIAL } },
    ...ERROR_OUTPUT,
  };
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
 * The nodes to paste beside the Notion steps, wired from the assembled
 * meeting, with the mapper's scripts in them. Idempotent: a meeting already at its path, or at its own collision
 * path, is skipped; a different meeting at its path sends it to the
 * collision path; only a free path is written. Nothing in it stops the run:
 * every failure — a refused meeting, a file it cannot read, both paths taken
 * by others, a failed commit — goes to "Atlas commit failed", which emails you.
 */
export function meetingWorkflow(
  scripts: { map: string; same: string; sameOther: string },
  sources: MeetingSources = EXAMPLE_SOURCES,
) {
  return {
    name: 'Meeting to Atlas (commit to pkm-space)',
    nodes: [
      fieldsNode(sources),
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
      notifyNode(sources),
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
      [NODES.failed]: { main: [to(NODES.notify)] },
    },
    settings: { executionOrder: 'v1' },
  };
}

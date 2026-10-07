import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  mapMeetingScript,
  sameMeetingAtOtherPathScript,
  sameMeetingScript,
  MAP_MEETING_NODE,
} from './code-node.ts';
import { mapMeeting, type MeetingFields } from './meeting-to-atlas.ts';
import { GITHUB_CREDENTIAL, meetingWorkflow, NODES, PARSE_NODE, VAULT_REPO } from './workflow.ts';

/*
 * The workflow JSON is what James imports into n8n. These tests hold it to
 * the mapper it was built from, run its Code nodes as n8n would, and check
 * the idempotency wiring and that it carries no secret.
 */

interface WorkflowNode {
  readonly name: string;
  readonly type: string;
  readonly parameters: Record<string, unknown>;
  readonly credentials?: Record<string, Record<string, unknown>>;
  readonly onError?: string;
}
interface Workflow {
  readonly nodes: readonly WorkflowNode[];
  readonly connections: Record<string, { main: { node: string }[][] }>;
}

const committedText = readFileSync(
  new URL('meeting-to-atlas.workflow.json', import.meta.url),
  'utf8',
);
const committed = JSON.parse(committedText) as Workflow;
const node = (name: string) => {
  const found = committed.nodes.find((each) => each.name === name);
  if (found === undefined) throw new Error(`no node ${name}`);
  return found;
};
const next = (from: string, output: number) =>
  committed.connections[from]?.main[output]?.map((each) => each.node) ?? [];

type CodeNodeRun = (
  json: unknown,
  $: (name: string) => { item: { json: unknown } },
) => {
  json: Record<string, unknown>;
};
const codeOf = (name: string) =>
  new Function('$json', '$', String(node(name).parameters.jsCode)) as CodeNodeRun;

const MEETING: MeetingFields = {
  title: 'Retro: Q3 🚀',
  date: '2026-10-06',
  start: '10:00',
  attendees: 'Ann Lee — ann@example.com\nPlatform Team — platform-team@example.com',
  nextSteps: '- \\[Ann Lee\\] Plan: write it',
  transcript: '### 00:00:01\nAnn Lee: Hello.\n### Transcription ended after 00:00:09',
  category: 'Retro',
  source: 'gemini',
  sourceId: 'fake-meeting-0003',
};

const scripts = () => ({
  map: mapMeetingScript(),
  same: sameMeetingScript(),
  sameOther: sameMeetingAtOtherPathScript(),
});
const asGitHub = (text: string) => ({
  content: Buffer.from(text).toString('base64'),
  size: Buffer.byteLength(text),
});
const fromMap = (meeting: unknown) => (name: string) => {
  expect(name).toBe(MAP_MEETING_NODE);
  return { item: { json: meeting } };
};

describe('the committed workflow', () => {
  it('is what `pnpm n8n:build` makes from the mapper now (rebuild after changing it)', () => {
    expect(committed).toEqual(JSON.parse(JSON.stringify(meetingWorkflow(scripts()))));
  });

  it('maps a meeting in its Code node exactly as the mapper does', () => {
    const run = codeOf(MAP_MEETING_NODE);
    const fail = () => {
      throw new Error('the map node reads no other node');
    };
    expect(run(MEETING, fail).json).toEqual({ ...mapMeeting(MEETING) });
    expect(() => run({ ...MEETING, start: '' }, fail)).toThrow(/no start time/);
  });

  it('reads an instant in James’s zone, America/Los_Angeles, unless told otherwise', () => {
    const run = codeOf(MAP_MEETING_NODE);
    const fail = () => {
      throw new Error('the map node reads no other node');
    };
    const { json } = run({ ...MEETING, date: '2026-10-07T00:02:00.000Z', start: '' }, fail);
    expect(json.content).toMatch(/^date: '2026-10-06'\nstart: '17:02'$/m);
  });

  it('tells, in its Same meeting? node, this meeting from another at the same path', () => {
    const run = codeOf(NODES.same);
    const meeting = mapMeeting(MEETING);
    expect(run(asGitHub(meeting.content), fromMap(meeting)).json).toMatchObject({
      duplicate: true,
      path: meeting.path,
    });
    const other = mapMeeting({ ...MEETING, sourceId: 'zzz' }).content;
    expect(run(asGitHub(other), fromMap(meeting)).json).toMatchObject({ duplicate: false });
  });

  it('refuses to guess about a file GitHub sends without content (over 1 MB)', () => {
    const run = codeOf(NODES.same);
    const meeting = mapMeeting(MEETING);
    const large = { content: '', encoding: 'none', size: 2_000_000 };
    expect(() => run(large, fromMap(meeting))).toThrow(/cannot read .*1 MB/);
    expect(run({ content: '', size: 0 }, fromMap(meeting)).json).toMatchObject({
      duplicate: false,
    });
  });

  it('skips at the other path only for this meeting; another one there is a failure', () => {
    const run = codeOf(NODES.sameOther);
    const meeting = mapMeeting(MEETING);
    expect(run(asGitHub(meeting.content), fromMap(meeting)).json).toMatchObject({
      duplicate: true,
    });
    const other = mapMeeting({ ...MEETING, sourceId: 'zzz' }).content;
    expect(() => run(asGitHub(other), fromMap(meeting))).toThrow(/another meeting/);
    expect(() => run({ content: '', size: 5_000_000 }, fromMap(meeting))).toThrow(/cannot read/);
  });
});

describe('idempotency', () => {
  it('writes the plain path only when looking it up fails (not found)', () => {
    expect(node(NODES.getPath).onError).toBe('continueErrorOutput');
    expect(next(NODES.getPath, 1)).toEqual([NODES.create]);
    expect(next(NODES.getPath, 0)).toEqual([NODES.same]);
    expect(node(NODES.create).parameters.filePath).toContain('.json.path }}');
  });

  it('skips the same meeting, and sends another meeting at its path to the collision path', () => {
    expect(next(NODES.same, 0)).toEqual([NODES.ifSame]);
    expect(next(NODES.ifSame, 0)).toEqual([NODES.skip]);
    expect(next(NODES.ifSame, 1)).toEqual([NODES.getCollision]);
    expect(next(NODES.getCollision, 1)).toEqual([NODES.createCollision]);
    expect(node(NODES.createCollision).parameters.filePath).toContain('.json.collisionPath }}');
  });

  it('checks a file at the collision path is this meeting before skipping it', () => {
    expect(next(NODES.getCollision, 0)).toEqual([NODES.sameOther]);
    expect(next(NODES.sameOther, 0)).toEqual([NODES.skip]);
  });
});

describe('the Atlas branch never stops or prevents the Notion write', () => {
  const incoming = (name: string) =>
    Object.entries(committed.connections)
      .filter(([, { main }]) => main.some((output) => output.some((each) => each.node === name)))
      .map(([from]) => from);

  it('is wired by James from the Notion node’s success output, so it starts after Notion', () => {
    expect(incoming(NODES.fields)).toEqual([]);
    const fieldValues = JSON.stringify(node(NODES.fields).parameters);
    // After the Notion node, $json is Notion's page: the fields come from the parse step by name.
    expect(fieldValues).not.toContain('$json');
    expect(fieldValues).toContain(`$('${PARSE_NODE}').item.json`);
  });

  it('sends every failure in it to "Atlas commit failed", never stopping the run', () => {
    const failing = [
      NODES.fields,
      NODES.map,
      NODES.same,
      NODES.sameOther,
      NODES.create,
      NODES.createCollision,
    ];
    for (const name of failing) {
      expect(node(name).onError, name).toBe('continueErrorOutput');
      expect(next(name, 1), name).toEqual([NODES.failed]);
    }
    expect(node(NODES.failed).type).toBe('n8n-nodes-base.noOp');
    expect(committed.connections[NODES.failed]).toBeUndefined();
  });

  it('lets no node in it stop the run', () => {
    const quiet = new Set(['n8n-nodes-base.noOp', 'n8n-nodes-base.if']);
    for (const each of committed.nodes) {
      if (!quiet.has(each.type)) expect(each.onError, each.name).toBe('continueErrorOutput');
    }
  });

  it('ends every path at a commit, a skip, or the failure node', () => {
    const ends = new Set<string>([NODES.create, NODES.createCollision, NODES.skip, NODES.failed]);
    const seen = new Set<string>();
    const walk = (name: string): void => {
      if (seen.has(name)) return;
      seen.add(name);
      const outputs = committed.connections[name]?.main ?? [];
      if (outputs.every((output) => output.length === 0)) expect(ends.has(name), name).toBe(true);
      for (const output of outputs) for (const each of output) walk(each.node);
    };
    walk(NODES.fields);
    expect([...seen].sort()).toEqual(committed.nodes.map((each) => each.name).sort());
  });
});

describe('the GitHub nodes', () => {
  const github = committed.nodes.filter((each) => each.type === 'n8n-nodes-base.github');

  it('commit to pkm-space on its default branch, with the meeting’s commit message', () => {
    expect(github).toHaveLength(4);
    for (const each of github) {
      expect(each.parameters).toMatchObject({
        resource: 'file',
        owner: { value: VAULT_REPO.owner },
        repository: { value: VAULT_REPO.repository },
        additionalParameters: {},
      });
    }
    expect(node(NODES.create).parameters.commitMessage).toContain('.json.commitMessage }}');
  });

  it('name their credential and carry no token', () => {
    for (const each of github)
      expect(each.credentials).toEqual({ githubApi: { name: GITHUB_CREDENTIAL } });
    expect(committedText).not.toMatch(/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|"id":\s*"\d+"/);
  });
});

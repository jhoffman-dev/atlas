#!/usr/bin/env node
// End-to-end smoke test of the whole chain against the REAL running app:
// MCP client -> apps/mcp over stdio -> the app's local API -> the webview's
// router -> the vault's files on disk.
//
// It writes notes, so it must only ever be pointed at a scratch vault. It lives
// here rather than in tools/ because pnpm does not hoist @modelcontextprotocol/client
// out of apps/mcp.
import { randomBytes } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP_MAIN = join(HERE, '..', 'dist', 'main.js');
const DEFAULT_CONNECTION = join(
  homedir(),
  'Library',
  'Application Support',
  'dev.jhoffman.atlas',
  'api.json',
);

const HELP = `Usage: pnpm smoke:api --vault <dir>

Drives every atlas_* MCP tool against the running Atlas app, checks the API's
host guards over raw HTTP, and reads the vault's files to confirm the writes.

  --vault <dir>   REQUIRED. The vault Atlas has open right now. It MUST be a
                  scratch vault made for this run: the smoke creates and edits
                  notes in it. Never point it at a vault you care about. A
                  path inside any repository (this repo's vault/ included) is
                  refused, and the run stops before writing anything if Atlas
                  has a vault of another name open.
  --help          Show this.

Before running: build the MCP server (pnpm --filter @atlas/mcp build), open the
scratch vault in Atlas, and turn the API on in Settings -> Connections.
ATLAS_CONNECTION_FILE overrides where the connection file is read from.
Exits non-zero if any check fails.
`;

const READY_TIMEOUT_MS = 30_000;
const INDEX_TIMEOUT_MS = 10_000;
const POLL_MS = 500;

class ToolError extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fail(message) {
  throw new Error(message);
}

function expect(condition, message) {
  if (!condition) fail(message);
}

/** Refuses anything that is not plainly a scratch vault outside this repo. */
function scratchVaultFrom(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { vault: { type: 'string' }, help: { type: 'boolean' } },
  });
  if (values.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  if (!values.vault) {
    process.stderr.write(`Refusing to run without --vault <scratch dir>.\n\n${HELP}`);
    process.exit(2);
  }
  if (!existsSync(join(values.vault, '.atlas'))) {
    process.stderr.write(`${values.vault} has no .atlas folder, so it is not a vault.\n`);
    process.exit(2);
  }
  const vault = realpathSync(values.vault);
  const repo = repoAround(vault);
  if (repo) {
    process.stderr.write(
      `Refusing: ${vault} is inside the repo at ${repo}. Use a scratch vault.\n`,
    );
    process.exit(2);
  }
  return vault;
}

/** The nearest folder at or above `dir` holding `.git` — a scratch vault is never in one. */
function repoAround(dir) {
  for (let at = dir; ; at = dirname(at)) {
    if (existsSync(join(at, '.git'))) return at;
    if (dirname(at) === at) return null;
  }
}

async function connectMcp() {
  expect(existsSync(MCP_MAIN), `${MCP_MAIN} is missing; run pnpm --filter @atlas/mcp build`);
  const client = new Client({ name: 'atlas-smoke', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [MCP_MAIN], stderr: 'inherit' }),
  );
  return client;
}

/** Calls one tool; answers its parsed JSON, or throws a ToolError with its message. */
async function callTool(mcp, name, args = {}) {
  const result = await mcp.callTool({ name, arguments: args });
  const text = result.content.map((part) => part.text ?? '').join('');
  if (result.isError) throw new ToolError(text);
  return JSON.parse(text);
}

/** Asserts the tool call is refused, and answers the refusal's message. */
async function refusal(mcp, name, args) {
  try {
    await callTool(mcp, name, args);
  } catch (error) {
    if (error instanceof ToolError) return error.message;
    throw error;
  }
  return fail(`${name} succeeded but should have been refused`);
}

async function poll(what, timeoutMs, attempt) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await attempt().catch((error) => ({ error }));
    if (last && !last.error) return last;
    await sleep(POLL_MS);
  }
  return fail(`${what} not within ${timeoutMs / 1000}s (last: ${last?.error?.message ?? last})`);
}

function frontmatterValue(text, key) {
  const block = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
  return new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(block)?.[1]?.trim();
}

/** A raw request with any headers, Host included — fetch silently drops a custom Host. */
function rawGet(port, headers) {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      { host: '127.0.0.1', port, path: '/v1/status', method: 'GET', headers },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      },
    );
    outgoing.on('error', reject);
    outgoing.end();
  });
}

async function readConnection() {
  const path = process.env.ATLAS_CONNECTION_FILE ?? DEFAULT_CONNECTION;
  return JSON.parse(await readFile(path, 'utf8'));
}

function statusSteps(ctx) {
  return [
    [
      'atlas_status: scratch vault open, index ready',
      async () => {
        const status = await poll('index ready', READY_TIMEOUT_MS, async () => {
          const answer = await callTool(ctx.mcp, 'atlas_status');
          if (!answer.vault || !answer.index.ready) throw new Error(JSON.stringify(answer));
          return answer;
        });
        expect(
          status.vault.name === basename(ctx.vault),
          `Atlas has "${status.vault.name}" open, not ${basename(ctx.vault)}; stopping before any write`,
        );
        ctx.vaultConfirmed = true;
        return `${status.vault.name}, ${status.index.notes} notes`;
      },
    ],
    [
      'atlas_list_types: task type with status options',
      async () => {
        const { types } = await callTool(ctx.mcp, 'atlas_list_types');
        const task = types.find((type) => type.name === 'task');
        expect(task, `no task type in ${types.map((type) => type.name).join(', ')}`);
        const status = task.properties.find((property) => property.key === 'status');
        expect(status?.options.length > 1, 'task.status has no options');
        ctx.newStatus = status.options.at(-1);
        return `${types.length} types; status -> ${ctx.newStatus}`;
      },
    ],
  ];
}

function noteSteps(ctx) {
  return [
    [
      'atlas_create_note from Task template',
      async () => {
        const { note } = await callTool(ctx.mcp, 'atlas_create_note', {
          name: ctx.name,
          template: 'Task',
        });
        expect(note.type === 'task', `type is ${note.type}, not task`);
        ctx.path = note.path;
        return note.path;
      },
    ],
    [
      'atlas_read_note',
      async () => {
        const { note } = await callTool(ctx.mcp, 'atlas_read_note', { path: ctx.path });
        expect(typeof note.modified === 'number', 'no modified');
        return `status ${note.properties.status}, modified ${note.modified}`;
      },
    ],
    [
      'atlas_update_properties status (file on disk)',
      async () => {
        await callTool(ctx.mcp, 'atlas_update_properties', {
          path: ctx.path,
          set: { status: ctx.newStatus },
        });
        const onDisk = frontmatterValue(
          await readFile(join(ctx.vault, ctx.path), 'utf8'),
          'status',
        );
        expect(onDisk === ctx.newStatus, `status on disk is ${onDisk}`);
        return `status: ${onDisk} on disk`;
      },
    ],
    [
      'atlas_append_to_note (file on disk)',
      async () => {
        const line = `Appended by the smoke: ${ctx.word}`;
        await callTool(ctx.mcp, 'atlas_append_to_note', { path: ctx.path, markdown: line });
        const onDisk = await readFile(join(ctx.vault, ctx.path), 'utf8');
        expect(onDisk.includes(line), 'appended line is not in the file');
        return 'appended line in file';
      },
    ],
    ...replaceSteps(ctx),
  ];
}

function replaceSteps(ctx) {
  const body = () => `# ${ctx.name}\n\nReplaced by the smoke: ${ctx.word}\n`;
  return [
    [
      'atlas_replace_note_body stale ifModified -> conflict',
      async () => {
        const { note } = await callTool(ctx.mcp, 'atlas_read_note', { path: ctx.path });
        ctx.modified = note.modified;
        const message = await refusal(ctx.mcp, 'atlas_replace_note_body', {
          path: ctx.path,
          markdown: body(),
          ifModified: note.modified - 1000,
        });
        expect(message.startsWith('conflict'), `refused, but not as conflict: ${message}`);
        return message;
      },
    ],
    [
      'atlas_replace_note_body right ifModified -> ok',
      async () => {
        await callTool(ctx.mcp, 'atlas_replace_note_body', {
          path: ctx.path,
          markdown: body(),
          ifModified: ctx.modified,
        });
        const onDisk = await readFile(join(ctx.vault, ctx.path), 'utf8');
        expect(onDisk.includes(`Replaced by the smoke: ${ctx.word}`), 'new body not in file');
        expect(frontmatterValue(onDisk, 'status') === ctx.newStatus, 'properties were lost');
        return 'body replaced, properties kept';
      },
    ],
  ];
}

function indexSteps(ctx) {
  return [
    [
      'atlas_search finds the note',
      async () => {
        const hit = await poll('search hit', INDEX_TIMEOUT_MS, async () => {
          const { hits } = await callTool(ctx.mcp, 'atlas_search', { q: ctx.word });
          const found = hits.find((candidate) => candidate.path === ctx.path);
          if (!found) throw new Error(`hits: ${JSON.stringify(hits.map((h) => h.path))}`);
          return found;
        });
        return hit.snippet;
      },
    ],
    [
      'atlas_backlinks sees a linking note',
      async () => {
        const { note } = await callTool(ctx.mcp, 'atlas_create_note', {
          name: `${ctx.name} linker`,
          body: `Points at [[${ctx.name}]].\n`,
        });
        const found = await poll('backlink', INDEX_TIMEOUT_MS, async () => {
          const { backlinks } = await callTool(ctx.mcp, 'atlas_backlinks', { path: ctx.path });
          if (!backlinks.some((link) => link.path === note.path)) {
            throw new Error(JSON.stringify(backlinks));
          }
          return backlinks;
        });
        return `${found.length} backlink(s), from ${note.path}`;
      },
    ],
    [
      'atlas_list_views + atlas_run_view',
      async () => {
        const { views } = await callTool(ctx.mcp, 'atlas_list_views');
        const view = views.find((candidate) => candidate.kind === 'view');
        expect(view, `no views in ${JSON.stringify(views)}`);
        const rows = await callTool(ctx.mcp, 'atlas_run_view', { path: view.path });
        expect(Array.isArray(rows.rows), `no rows from ${view.path}`);
        return `${views.length} views; "${view.path}" -> ${rows.rows.length} rows`;
      },
    ],
    [
      'atlas_list_type_views answers the task tabs in order',
      async () => {
        const answer = await callTool(ctx.mcp, 'atlas_list_type_views', { type: 'task' });
        expect(answer.type === 'task', `asked for task, got ${JSON.stringify(answer.type)}`);
        expect(answer.views.length > 0, 'a type always has at least its default tab');
        return answer.views
          .map((view) => `${view.title}${view.virtual ? ' (virtual)' : ''}`)
          .join(', ');
      },
    ],
    [
      'atlas_list_templates + atlas_read_template (read-only)',
      async () => {
        const { templates } = await callTool(ctx.mcp, 'atlas_list_templates');
        if (templates.length === 0) return 'no templates in this vault';
        const [first] = templates;
        const { template } = await callTool(ctx.mcp, 'atlas_read_template', { name: first.name });
        expect(template.path === first.path, `read ${template.path}, listed ${first.path}`);
        return `${templates.length} templates; "${first.name}" used for ${first.uses.length} thing(s)`;
      },
    ],
    [
      'atlas_query tasks includes the note',
      async () => {
        const rows = await callTool(ctx.mcp, 'atlas_query', {
          type: 'task',
          filters: [{ key: 'status', operator: 'is', value: ctx.newStatus }],
        });
        expect(JSON.stringify(rows.rows).includes(ctx.path), `${ctx.path} not in rows`);
        return `${rows.rows.length} rows with status ${ctx.newStatus}`;
      },
    ],
    ...sqlSteps(ctx),
  ];
}

function sqlSteps(ctx) {
  return [
    [
      'atlas_sql SELECT ok',
      async () => {
        const rows = await callTool(ctx.mcp, 'atlas_sql', {
          sql: 'SELECT path FROM files WHERE path = ?',
          params: [ctx.path],
        });
        expect(rows.rows.length === 1, `expected 1 row, got ${rows.rows.length}`);
        return '1 row';
      },
    ],
    [
      'atlas_sql ATTACH refused',
      async () => {
        const attach = join(ctx.vault, 'smoke-attach.db');
        const message = await refusal(ctx.mcp, 'atlas_sql', {
          sql: `ATTACH DATABASE '${attach}' AS other`,
        });
        expect(!existsSync(attach), `ATTACH created ${attach}`);
        return message;
      },
    ],
    [
      'atlas_sql DELETE refused',
      async () => {
        const message = await refusal(ctx.mcp, 'atlas_sql', { sql: 'DELETE FROM files' });
        const rows = await callTool(ctx.mcp, 'atlas_sql', { sql: 'SELECT count(*) FROM files' });
        expect(rows.rows[0][0] > 0, 'files table is empty after the refused DELETE');
        return message;
      },
    ],
  ];
}

/** Archive the note, find it in the Archive and in search, and put it back where it was. */
function archiveSteps(ctx) {
  return [
    [
      'atlas_archive moves the note under Archive/ (file on disk)',
      async () => {
        const { moves, failed } = await callTool(ctx.mcp, 'atlas_archive', { paths: [ctx.path] });
        expect(failed.length === 0, `failed: ${JSON.stringify(failed)}`);
        ctx.archived = moves[0]?.to;
        expect(ctx.archived === `Archive/${ctx.path}`, `moved to ${ctx.archived}`);
        expect(!existsSync(join(ctx.vault, ctx.path)), `${ctx.path} is still there`);
        const onDisk = await readFile(join(ctx.vault, ctx.archived), 'utf8');
        expect(frontmatterValue(onDisk, 'archivedFrom') === ctx.path, 'no archivedFrom on disk');
        return ctx.archived;
      },
    ],
    [
      'atlas_archived lists it; atlas_search finds it only with includeArchived',
      async () => {
        await poll('archive listing', INDEX_TIMEOUT_MS, async () => {
          const { notes } = await callTool(ctx.mcp, 'atlas_archived', { search: ctx.word });
          if (!notes.some((note) => note.path === ctx.archived)) {
            throw new Error(JSON.stringify(notes));
          }
        });
        const { hits } = await callTool(ctx.mcp, 'atlas_search', { q: ctx.word });
        expect(!hits.some((hit) => hit.path === ctx.archived), 'search found an archived note');
        const wider = await callTool(ctx.mcp, 'atlas_search', {
          q: ctx.word,
          includeArchived: true,
        });
        const hit = wider.hits.find((candidate) => candidate.path === ctx.archived);
        expect(hit?.archived === true, `includeArchived hits: ${JSON.stringify(wider.hits)}`);
        return 'listed, and marked archived in search';
      },
    ],
    [
      'atlas_unarchive puts it back (file on disk)',
      async () => {
        const { moves } = await callTool(ctx.mcp, 'atlas_unarchive', { paths: [ctx.archived] });
        expect(moves[0]?.to === ctx.path, `restored to ${moves[0]?.to}`);
        const onDisk = await readFile(join(ctx.vault, ctx.path), 'utf8');
        expect(frontmatterValue(onDisk, 'archivedFrom') === undefined, 'archivedFrom is left');
        return ctx.path;
      },
    ],
  ];
}

/**
 * The entries at the head of a log, newest first, that were not in it before;
 * null when its newest entry from before is gone, so it was rewritten.
 */
function entriesAddedTo(before, after) {
  const [newest] = before;
  if (newest === undefined) return after;
  const same = (entry) => entry.at === newest.at && entry.heading === newest.heading;
  const at = after.findIndex(same);
  return at === -1 ? null : after.slice(0, at);
}

const entryKind = (entry) => (entry.trigger ? `${entry.kind} (${entry.trigger})` : entry.kind);

/** What the app writes to a log of its own accord: a scheduled or on-open run, and first seen. */
const byTheAppsClock = (entry) =>
  entry.kind === 'seen' ||
  ((entry.kind === 'run' || entry.kind === 'failed') &&
    (entry.trigger === 'schedule' || entry.trigger === 'open'));

/** Automations are read-only through the API: a scratch vault may have none, which is fine. */
function automationSteps(ctx) {
  return [
    [
      'atlas_automations, its log and a dry run that writes nothing (log on disk unchanged)',
      async () => {
        const { automations, broken } = await callTool(ctx.mcp, 'atlas_automations');
        const [first] = automations;
        if (first === undefined) return `no automations (${broken.length} broken)`;
        const logFile = join(ctx.vault, '.atlas', 'automations', 'log', `${first.id}.md`);
        const readLog = async () => (existsSync(logFile) ? await readFile(logFile, 'utf8') : null);
        const logEntries = async () =>
          (await callTool(ctx.mcp, 'atlas_automation_log', { id: first.id, limit: 100 })).entries;
        const [before, entries] = [await readLog(), await logEntries()];
        const { plan } = await callTool(ctx.mcp, 'atlas_automation_dry_run', { id: first.id });
        const [after, entriesAfter] = [await readLog(), await logEntries()];
        const done = `${first.id}: ${entries.length} log entries; ${plan.summary}`;
        if (after === before) return done;
        const added = entriesAddedTo(entries, entriesAfter);
        expect(added !== null, 'the rule’s log was rewritten during the dry run, not added to');
        const kinds = added.map(entryKind).join(', ');
        expect(added.length > 0, 'the rule’s log changed during the dry run, with no new entry');
        // The app's own clock may log a run, or mark a rule first seen, at the same moment.
        expect(
          added.every(byTheAppsClock),
          `the rule’s log gained ${kinds} during the dry run, which the app's clock never writes`,
        );
        return `${done} (the app's clock logged ${kinds} meanwhile)`;
      },
    ],
    [
      'atlas_automation_log refuses an id no rule has',
      async () => refusal(ctx.mcp, 'atlas_automation_log', { id: `no-such-${ctx.word}` }),
    ],
  ];
}

function captureSteps(ctx) {
  return [
    [
      'atlas_daily_note',
      async () => {
        const { note, created } = await callTool(ctx.mcp, 'atlas_daily_note');
        expect(existsSync(join(ctx.vault, note.path)), `${note.path} not on disk`);
        return `${note.path} (created: ${created})`;
      },
    ],
    [
      'atlas_capture_task',
      async () => {
        const { note } = await callTool(ctx.mcp, 'atlas_capture_task', {
          text: `Smoke capture ${ctx.word}`,
        });
        expect(note.type === 'task', `type is ${note.type}`);
        expect(existsSync(join(ctx.vault, note.path)), `${note.path} not on disk`);
        return note.path;
      },
    ],
  ];
}

function httpSteps() {
  const expectStatus = (want, headers) => async () => {
    const { port, token } = await readConnection();
    const got = await rawGet(port, headers(token, port));
    expect(got === want, `status ${got}, expected ${want}`);
    return String(got);
  };
  return [
    [
      'HTTP right token -> 200',
      expectStatus(200, (token) => ({ Authorization: `Bearer ${token}` })),
    ],
    ['HTTP no token -> 401', expectStatus(401, () => ({}))],
    [
      'HTTP wrong token -> 401',
      expectStatus(401, () => ({ Authorization: `Bearer ${'0'.repeat(64)}` })),
    ],
    [
      'HTTP Origin header -> 403',
      expectStatus(403, (token) => ({
        Authorization: `Bearer ${token}`,
        Origin: 'https://evil.example',
      })),
    ],
    [
      'HTTP wrong Host -> 403',
      expectStatus(403, (token) => ({
        Authorization: `Bearer ${token}`,
        Host: 'evil.example',
      })),
    ],
  ];
}

async function runSteps(steps, ctx) {
  const results = [];
  for (const [name, run] of steps) {
    const started = Date.now();
    try {
      const detail = await run();
      results.push({ name, ok: true, detail, ms: Date.now() - started });
    } catch (error) {
      results.push({ name, ok: false, detail: error.message, ms: Date.now() - started });
      // Nothing is written until the open vault is known to be the scratch one.
      if (!ctx.vaultConfirmed) break;
    }
  }
  return results;
}

function printTable(results) {
  const width = Math.max(...results.map((result) => result.name.length));
  const oneLine = (text) => String(text).replace(/\s+/g, ' ').slice(0, 160);
  for (const { name, ok, detail, ms } of results) {
    const time = `${ms}ms`.padStart(7);
    process.stdout.write(
      `${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(width)}  ${time}  ${oneLine(detail)}\n`,
    );
  }
  const failed = results.filter((result) => !result.ok).length;
  process.stdout.write(`\n${results.length - failed} passed, ${failed} failed\n`);
  return failed;
}

async function main() {
  const vault = scratchVaultFrom(process.argv.slice(2));
  const word = `smoke${randomBytes(6).toString('hex')}`;
  const ctx = { vault, word, name: `Smoke ${word}`, mcp: await connectMcp() };
  try {
    const results = await runSteps(
      [
        ...statusSteps(ctx),
        ...noteSteps(ctx),
        ...indexSteps(ctx),
        ...captureSteps(ctx),
        ...archiveSteps(ctx),
        ...automationSteps(ctx),
        ...httpSteps(),
      ],
      ctx,
    );
    process.exitCode = printTable(results) === 0 ? 0 : 1;
  } finally {
    await ctx.mcp.close();
  }
}

main().catch((error) => {
  process.stderr.write(`smoke: ${error.stack ?? error}\n`);
  process.exit(1);
});

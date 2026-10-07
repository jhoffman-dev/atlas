import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { API_RESPOND_COMMAND } from '@atlas/application';

/**
 * The one seam neither the TypeScript tests nor the Rust tests can see: the command
 * names crossing the IPC boundary. Renaming a command on one side only would leave
 * both suites green and the app broken, so the two lists are compared directly.
 */

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

function commandsExposedByRust(): Set<string> {
  const source = readFileSync(here('../src-tauri/src/lib.rs'), 'utf8');
  const handler = /generate_handler!\[([\s\S]*?)\]/.exec(source);
  expect(handler, 'generate_handler! block not found in lib.rs').not.toBeNull();
  return new Set(
    (handler?.[1] ?? '')
      .split(',')
      .map((entry) => entry.trim().split('::').at(-1) ?? '')
      .filter((name) => name !== ''),
  );
}

/** Every adapter source file, in every folder: a command called from any of them crosses the boundary. */
function adapterSources(): string[] {
  const root = here('../../../packages/adapters/src');
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => join(root, file));
}

function commandsCalledByAdapters(): Set<string> {
  const called = new Set<string>();
  for (const file of adapterSources()) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/invoke(?:<[^>]*>)?\(\s*'([a-zA-Z_]+)'/g)) {
      const name = match[1];
      if (name !== undefined) called.add(name);
    }
  }
  return called;
}

describe('IPC contract', () => {
  it('finds the commands the Rust side exposes', () => {
    expect(commandsExposedByRust().size).toBeGreaterThan(0);
  });

  it('finds the commands the adapters call', () => {
    expect(commandsCalledByAdapters().size).toBeGreaterThan(0);
  });

  it('every command the adapters call is exposed by Rust', () => {
    const exposed = commandsExposedByRust();
    const missing = [...commandsCalledByAdapters()].filter((name) => !exposed.has(name));
    expect(missing, `not registered in generate_handler!: ${missing.join(', ')}`).toEqual([]);
  });

  // The API's commands are called from `adapters/src/api`, and the answer's
  // name is fixed by the contract as well as by Rust: all three must agree.
  it('calls every command the local API needs, the answer under the name the contract gives it', () => {
    const called = commandsCalledByAdapters();
    const needed = [
      API_RESPOND_COMMAND,
      'api_status',
      'api_set_enabled',
      'api_token',
      'api_rotate_token',
      'api_router_ready',
    ];
    expect(needed.filter((name) => !called.has(name))).toEqual([]);
  });

  // A secret's value goes into the host and never comes back out: the host
  // fills it into a request itself (P12-06). A command that answered with one
  // would hand it to the webview, so the only secret commands are these four,
  // none of which answers with a value (`secret_bind` only moves where one goes).
  it('exposes no command that could hand a secret back to the webview', () => {
    const secretCommands = [...commandsExposedByRust()].filter((name) => /secret/i.test(name));
    expect(secretCommands.sort()).toEqual([
      'secret_bind',
      'secret_delete',
      'secret_list',
      'secret_set',
    ]);
  });
});

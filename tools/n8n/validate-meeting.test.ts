import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* The CLI James runs on a dry run's output: Atlas's own validator, from plain `node`. */

const cli = fileURLToPath(new URL('validate-meeting.mjs', import.meta.url));
const fixture = (path: string) =>
  fileURLToPath(new URL(`../../packages/domain/src/meetings/fixtures/${path}`, import.meta.url));
const run = (...files: string[]) =>
  spawnSync(process.execPath, [cli, ...files], { encoding: 'utf8', timeout: 60_000 });

describe('validate-meeting', () => {
  it('passes a file that follows the contract', () => {
    const result = run(fixture('valid/gemini-platform-sync.md'));
    expect(result.stdout).toMatch(/^ok {4}.*gemini-platform-sync\.md \(4 turns\)/);
    expect(result.status).toBe(0);
  });

  it('names each problem of a file that does not, and exits 1', () => {
    const result = run(
      fixture('valid/granola-vendor-call.md'),
      fixture('invalid/missing-required.md'),
    );
    expect(result.stdout).toMatch(/FAIL {2}.*missing-required\.md\n {6}title: /);
    expect(result.status).toBe(1);
  });

  it('reports a file it cannot read as a FAIL line, not a stack trace, and checks the rest', () => {
    const result = run('no-such-meeting.md', fixture('valid/gemini-platform-sync.md'));
    expect(result.stdout).toMatch(/^FAIL {2}no-such-meeting\.md\n {6}cannot read: .*ENOENT/m);
    expect(result.stdout).toMatch(/^ok {4}.*gemini-platform-sync\.md/m);
    expect(result.stderr).not.toMatch(/at .*validate-meeting\.mjs/);
    expect(result.status).toBe(1);
  });

  it('says how to use it when given no file', () => {
    const result = run();
    expect(result.stderr).toMatch(/usage:/);
    expect(result.status).toBe(2);
  });
});

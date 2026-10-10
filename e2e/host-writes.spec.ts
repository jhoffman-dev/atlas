import { expect, test } from '@playwright/test';
import { readdir } from 'node:fs/promises';
import { createVault, installHost } from './host.ts';

/**
 * Issue #5: the stub's `write_text_file` against two writes to one note at once.
 *
 * The Rust host's `write_text_file` is a synchronous command, so two of them
 * never interleave: the second sees the file the first wrote and is refused
 * when it names the time the note was read at before. The stub answers across
 * `await`s, and once let both writes pass that check and share one temporary
 * file — a write the host would refuse got through, and the note could end up
 * holding bytes neither writer sent. Every spec writes through this stub, so it
 * has to refuse exactly as the host does.
 */

const NOTE = 'race.md';
const FIRST = 'The first writer says a good deal more than the second one does.\n';
const SECOND = 'Second.\n';
const REFUSED = 'the note changed on disk since it was opened';

interface Settled {
  status: 'fulfilled' | 'rejected';
  message?: string;
}

test('two writes to one note at once: one lands whole, the other is refused', async ({ page }) => {
  const vault = await createVault();
  await vault.write(NOTE, 'As it was read.\n');
  const host = await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();

  // Both writers read the note at the same moment, so both name the same time.
  const release = host.holdWrites(NOTE);
  await page.evaluate(
    async ([path, first, second]) => {
      const { invoke } = (
        window as unknown as {
          __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__;
      const vaultRoot = ((await invoke('current_vault', {})) as { absolutePath: string })
        .absolutePath;
      const { modified } = (await invoke('read_text_file', { path })) as { modified: number };
      const write = (contents: string) =>
        invoke('write_text_file', { path, contents, expectedModified: modified, vault: vaultRoot });
      (window as unknown as { __race: Promise<unknown>[] }).__race = [write(first), write(second)];
    },
    [NOTE, FIRST, SECOND],
  );
  // Both are inside the host before either is let go, so neither has landed yet.
  await expect.poll(() => host.writesTo(NOTE)).toBe(2);
  release();

  const settled = await page.evaluate(async () => {
    const results = await Promise.allSettled(
      (window as unknown as { __race: Promise<unknown>[] }).__race,
    );
    return results.map((result) =>
      result.status === 'fulfilled'
        ? { status: result.status }
        : { status: result.status, message: String((result.reason as Error).message) },
    );
  });

  const landed = settled.flatMap((result: Settled, index) =>
    result.status === 'fulfilled' ? [index === 0 ? FIRST : SECOND] : [],
  );
  const refusals = settled.filter((result: Settled) => result.status === 'rejected');
  expect(landed).toHaveLength(1);
  expect(refusals).toHaveLength(1);
  expect(refusals[0]?.message).toContain(REFUSED);
  expect(await vault.read(NOTE)).toBe(landed[0]);
  expect((await readdir(vault.root)).filter((name) => name.includes('atlas-tmp'))).toEqual([]);
});

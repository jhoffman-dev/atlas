/*
 * `pnpm perf:semantic` — semantic search at James's scale (P32-02): 5,000
 * notes of ten paragraphs each, 50,000 blocks.
 *
 * - **The first build never freezes the window.** The cache is built from
 *   nothing while the window's frames are watched; the stand-in model takes
 *   as long as the real one (about 2.2 ms a passage, ADR-0031), off the page's
 *   thread as the host runs it. Four notes of 100 KB are among the 5,000: a
 *   long note is parsed off the window's thread, not in it. No frame over
 *   50 ms, ever, fails the run.
 * - **A relaunch with the cache built never freezes the window.** The cache's
 *   50,000 blocks are loaded and made searchable on launch (warm), and no
 *   frame over 50 ms fails the run.
 * - **A search by meaning over 50,000 blocks** is timed from the key to the
 *   hits drawn, and the brute-force ranking alone is timed beside it.
 *
 * Times are machine-dependent, so the numbers are written to
 * `test-results/perf/semantic.json` and printed; only the frame rule fails.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '../../e2e/fixtures.ts';
import { installHost } from '../../e2e/host.ts';
import { DIMENSIONS, meaningVector } from '../../e2e/embedding-host.ts';
import { topByCosine } from '../../packages/domain/src/embeddings/cosine-ranking.ts';
import type { FixtureFile } from './fixture-vault.ts';
import { percentile } from './probe.ts';
import { writeVault } from './session.ts';

const NOTES = 5_000;
const PARAGRAPHS = 10;
/** Long notes among the 5,000: about 100 KB each, as a pasted transcript or a long log is. */
const LONG_NOTES = 4;
const LONG_PARAGRAPHS = 900;
const BLOCKS = (NOTES - LONG_NOTES) * PARAGRAPHS + LONG_NOTES * LONG_PARAGRAPHS;
/** About what Arctic Embed XS takes a passage on this Mac, in calls of 32 (ADR-0031). */
const MS_PER_PASSAGE = 2.2;
/** A frame longer than this is a freeze a person feels. */
const LONGEST_FRAME_MS = 50;
const SEARCHES = 10;

const WORDS = [
  'budget',
  'quarter',
  'hiring',
  'roadmap',
  'invoice',
  'vendor',
  'launch',
  'review',
  'payroll',
  'contract',
  'travel',
  'garden',
  'kitchen',
  'printer',
  'meeting',
  'lease',
  'renewal',
  'audit',
  'design',
  'research',
  'customer',
  'support',
  'release',
  'sprint',
  'offsite',
  'pricing',
  'schedule',
  'deadline',
  'proposal',
  'feedback',
  'onboarding',
  'migration',
];
const PEOPLE = ['Mara Quill', 'Tobias Fenn', 'Ines Varga', 'Odile Brandt', 'Wren Calloway'];

/** A paragraph that differs from every other: its note's and its own number are in it. */
function paragraph(note: number, at: number): string {
  const pick = (offset: number) => WORDS[(note * 7 + at * 13 + offset * 5) % WORDS.length];
  const who = PEOPLE[(note + at) % PEOPLE.length];
  return `${who} said the ${pick(1)} and the ${pick(2)} need a ${pick(3)} before the ${pick(4)}, note ${note} point ${at}.`;
}

function semanticFixture(): FixtureFile[] {
  return Array.from({ length: NOTES }, (_, note) => {
    const paragraphs = note < LONG_NOTES ? LONG_PARAGRAPHS : PARAGRAPHS;
    return {
      path: `Notes/${String(Math.floor(note / 500)).padStart(2, '0')}/Note ${note}.md`,
      contents: Array.from({ length: paragraphs }, (__, at) => paragraph(note, at)).join('\n\n'),
    };
  });
}

/** Watches every frame from now on: the longest gap between two, and how many ran over the limit. */
function installFrameWatch(limit: number) {
  const watch = { longest: 0, over: 0, frames: 0, last: 0, start: 0, late: [] as number[] };
  Object.assign(window, {
    __frames: watch,
    __resetFrames() {
      Object.assign(watch, {
        longest: 0,
        over: 0,
        frames: 0,
        last: 0,
        start: performance.now(),
        late: [],
      });
    },
  });
  const tick = (now: number) => {
    if (watch.last !== 0) {
      const gap = now - watch.last;
      watch.longest = Math.max(watch.longest, gap);
      if (gap > limit) {
        watch.over += 1;
        // When, in ms from the reset, and how long: to tell the build's start from its middle.
        watch.late.push(Math.round(watch.last - watch.start), Math.round(gap));
      }
      watch.frames += 1;
    }
    watch.last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const frames = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __frames: { longest: number; over: number; frames: number; late: number[] };
        }
      ).__frames,
  );

async function openPaletteByMeaning(page: Page) {
  await page.keyboard.press('Meta+k');
  const palette = page.getByRole('dialog', { name: 'Search notes' });
  await expect(palette).toBeVisible();
  await palette.getByRole('switch', { name: 'By meaning' }).click();
  return palette;
}

test('the first build of 50,000 blocks never freezes the window, and a search is quick', async ({
  page,
}) => {
  test.setTimeout(1_200_000);
  const vault = await writeVault(semanticFixture());
  const host = await installHost(page, vault, { embedMsPerText: MS_PER_PASSAGE });
  await page.addInitScript(installFrameWatch, LONGEST_FRAME_MS);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/^5,\d{3} notes indexed/)).toBeVisible({ timeout: 300_000 });

  // The first search by meaning starts the build; the palette is closed so the
  // frames watched are the build's alone, not its searches as it grows.
  let palette = await openPaletteByMeaning(page);
  await page.getByRole('searchbox', { name: 'Search the vault' }).fill('payroll');
  await expect(palette.getByRole('status')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window as unknown as { __resetFrames: () => void }).__resetFrames());
  const started = Date.now();
  await expect
    .poll(() => host.embeddings.passages().length, { timeout: 1_000_000, intervals: [1_000] })
    .toBe(BLOCKS);
  await expect
    .poll(() => host.callsTo('embedding_cache_put'), { intervals: [500] })
    .toBeGreaterThan(0);
  const buildMs = Date.now() - started;
  const during = await frames(page);

  // Searches by meaning over the whole cache, timed from the key to the hits drawn.
  palette = await openPaletteByMeaning(page);
  const field = page.getByRole('searchbox', { name: 'Search the vault' });
  const searchMs: number[] = [];
  for (let at = 0; at < SEARCHES; at += 1) {
    const wanted = `${WORDS[at]} ${PEOPLE[at % PEOPLE.length]}`;
    const begun = Date.now();
    await field.fill(wanted);
    await expect(palette.getByRole('option').first()).toBeVisible();
    await expect(palette.getByRole('status')).toHaveCount(0);
    searchMs.push(Date.now() - begun);
    await field.fill('');
  }

  // The ranking alone, in Node: brute force over 50,000 vectors of the model's length.
  const vectors = semanticFixture().flatMap((file) =>
    file.contents.split('\n\n').map((text) => Float32Array.from(meaningVector(text))),
  );
  const query = Float32Array.from(meaningVector('payroll budget Mara Quill'));
  const rankMs: number[] = [];
  for (let at = 0; at < SEARCHES; at += 1) {
    const begun = performance.now();
    topByCosine({ query, vectors, limit: 20 });
    rankMs.push(performance.now() - begun);
  }

  const result = {
    notes: NOTES,
    blocks: BLOCKS,
    dimensions: DIMENSIONS,
    msPerPassage: MS_PER_PASSAGE,
    buildSeconds: Math.round(buildMs / 100) / 10,
    buildFrames: during,
    searchMs: { p50: percentile(searchMs, 50), p95: percentile(searchMs, 95) },
    rankMs: {
      p50: Math.round(percentile(rankMs, 50) * 10) / 10,
      p95: Math.round(percentile(rankMs, 95) * 10) / 10,
    },
  };
  await mkdir(join('test-results', 'perf'), { recursive: true });
  await writeFile(
    join('test-results', 'perf', 'semantic.json'),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(JSON.stringify(result, null, 2));

  expect(during.frames, 'frames were drawn while the cache was built').toBeGreaterThan(0);
  expect(
    pairsOf(during.late),
    `frames over ${LONGEST_FRAME_MS} ms while the cache was built ([ms in, ms long])`,
  ).toEqual([]);
});

/** `[ms in, ms long]` of each frame the watch kept as over the limit. */
const pairsOf = (late: readonly number[]) =>
  late.flatMap((value, at) => (at % 2 === 0 ? [[value, late[at + 1] ?? 0]] : []));

test('a relaunch with 50,000 cached blocks never freezes the window', async ({ page }) => {
  test.setTimeout(1_200_000);
  const vault = await writeVault(semanticFixture());
  const host = await installHost(page, vault, { embedMsPerText: 0 });
  await page.addInitScript(installFrameWatch, LONGEST_FRAME_MS);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/^5,\d{3} notes indexed/)).toBeVisible({ timeout: 300_000 });
  const palette = await openPaletteByMeaning(page);
  await page.getByRole('searchbox', { name: 'Search the vault' }).fill('payroll');
  await expect(palette.getByRole('status')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect
    .poll(() => host.embeddings.passages().length, { timeout: 1_000_000, intervals: [1_000] })
    .toBe(BLOCKS);
  // The last write lands a moment after the last passage is embedded.
  await expect
    .poll(() => host.callsTo('embedding_cache_put'), { intervals: [500] })
    .toBeGreaterThan(0);
  await page.waitForTimeout(5_000);

  // The window is opened again: the cache is on disk, the vault was opted in, the index is kept.
  const loadsBefore = host.callsTo('embedding_cache_load');
  await page.reload();
  await page.evaluate(() => (window as unknown as { __resetFrames: () => void }).__resetFrames());
  await expect(page.getByText(/^5,\d{3} notes indexed/)).toBeVisible({ timeout: 300_000 });
  await expect
    .poll(() => host.callsTo('embedding_cache_load'), { intervals: [500] })
    .toBeGreaterThan(loadsBefore);
  // Long enough for the load to be read, and the notes compared with what it holds.
  await page.waitForTimeout(10_000);
  const warm = await frames(page);
  expect(host.embeddings.passages(), 'nothing is embedded again on a relaunch').toHaveLength(
    BLOCKS,
  );

  const result = { warmLaunchFrames: warm };
  await mkdir(join('test-results', 'perf'), { recursive: true });
  await writeFile(
    join('test-results', 'perf', 'semantic-warm.json'),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(JSON.stringify(result, null, 2));
  expect(warm.frames, 'frames were drawn on the relaunch').toBeGreaterThan(0);
  expect(
    pairsOf(warm.late),
    `frames over ${LONGEST_FRAME_MS} ms on a relaunch ([ms in, ms long])`,
  ).toEqual([]);
});

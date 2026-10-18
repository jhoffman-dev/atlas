import { expect, test, type Page } from '@playwright/test';
import {
  createVault,
  emitVaultChanged,
  installHost,
  type FakeHost,
  type FakeVault,
} from './host.ts';

/**
 * Attack on #130 (PR #283), in WebKit. The PR holds the Inbox's rows until its
 * five offers are read (or 1 s passes), then keeps any later offer for the
 * next open. The invariant under attack: once a row is on screen, nothing
 * arriving late moves it, and the rows stay reachable whatever is still read.
 */

const ROWS = 4;

const PROPOSAL = [
  '---',
  'type: proposal',
  'kind: task',
  'state: open',
  'confidence: high',
  'made_by: after-meeting · run 1',
  'payload:',
  '  title: Send Tobias the file',
  '---',
  '',
  'Mara Quill asked for it.',
  '',
].join('\n');

/** A settings note whose frontmatter does not parse, so the Inbox warns that it is unreadable. */
const BROKEN_SETTINGS = ['---', 'name: [Mara Quill', 'quickAdd: [task', '---', ''].join('\n');

const inboxButton = (page: Page) => page.getByRole('button', { name: /^Inbox/ });
const inboxArticle = (page: Page) => page.getByRole('article', { name: 'Inbox' });
/** The row's title button found by markup, so it is found while held (hidden, inert) too. */
const drawnRow = (page: Page, n: number) =>
  page.locator('.inbox__grid button').filter({ hasText: new RegExp(`^Item ${n}$`) });
const row = (page: Page, n: number) =>
  inboxArticle(page).getByRole('button', { name: `Item ${n}`, exact: true });

async function vaultWithRows(): Promise<FakeVault> {
  const vault = await createVault();
  await vault.mkdir('Inbox');
  for (let n = 1; n <= ROWS; n++) await vault.write(`Inbox/Item ${n}.md`, `Body of item ${n}.\n`);
  return vault;
}

async function openVault(page: Page, vault: FakeVault): Promise<FakeHost> {
  const host = await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible({ timeout: 60_000 });
  return host;
}

/** How far, at most, the Inbox row titled `title` moved over the next `frames` frames. */
function largestMove(page: Page, title: string, frames: number): Promise<number> {
  return page.evaluate(
    async ({ title, frames }) => {
      const find = () =>
        [...document.querySelectorAll('.inbox__grid button')].find(
          (button) => button.textContent?.trim() === title,
        );
      const at = () => find()?.getBoundingClientRect().top ?? Number.NaN;
      const start = at();
      let largest = 0;
      for (let frame = 0; frame < frames; frame++) {
        await new Promise((done) => requestAnimationFrame(done));
        const now = at();
        largest = Math.max(largest, Number.isNaN(now) ? Infinity : Math.abs(now - start));
      }
      return largest;
    },
    { title, frames },
  );
}

/**
 * Clicks the Inbox button in the page and counts, frame by frame, how long
 * until the row titled `title` is both drawn and visible.
 */
function msUntilRowVisible(page: Page, title: string): Promise<number> {
  return page.evaluate(async (title) => {
    const button = [...document.querySelectorAll('button')].find((b) =>
      /^Inbox/.test(b.getAttribute('aria-label') ?? b.textContent?.trim() ?? ''),
    );
    if (button === undefined) throw new Error('no Inbox button');
    const visible = () => {
      const found = [...document.querySelectorAll('.inbox__grid button')].find(
        (b) => b.textContent?.trim() === title,
      );
      return found !== undefined && getComputedStyle(found).visibility === 'visible';
    };
    const start = performance.now();
    button.click();
    while (!visible()) {
      await new Promise((done) => requestAnimationFrame(done));
      if (performance.now() - start > 10_000) return Infinity;
    }
    return performance.now() - start;
  }, title);
}

test('on a vault with nothing to offer, the rows show without waiting out the 1 s hold (#130 attack)', async ({
  page,
}) => {
  const vault = await vaultWithRows();
  await openVault(page, vault);
  const ms = await msUntilRowVisible(page, 'Item 1');
  test.info().annotations.push({ type: 'hold-ms', description: ms.toFixed(0) });
  console.warn(`#130 attack: Inbox open → rows visible in ${ms.toFixed(0)} ms`);
  expect(ms).toBeLessThan(1000);
});

/** Where the row's top edge is now, in the viewport. */
async function topOf(page: Page, n: number): Promise<number> {
  const box = await row(page, n).boundingBox();
  if (box === null) throw new Error(`Item ${n} is not laid out`);
  return box.y;
}

test('a settings-note warning that arrives after the rows are drawn does not move them (#130 attack)', async ({
  page,
}) => {
  const vault = await vaultWithRows();
  await openVault(page, vault);
  await inboxButton(page).click();
  await expect(row(page, 3)).toBeVisible();
  const before = await topOf(page, 3);

  // The settings note turns unreadable while the Inbox is open (a sync, an edit elsewhere).
  await vault.mkdir('.atlas');
  await vault.write('.atlas/settings.md', BROKEN_SETTINGS);
  await emitVaultChanged(page, ['.atlas/settings.md']);
  await expect(
    page.getByRole('alert', { name: 'Meetings and automations are paused' }),
  ).toBeVisible();
  expect(await topOf(page, 3)).toBe(before);
});

test('a proposals section that arrives after the rows are drawn does not move them (#130 attack)', async ({
  page,
}) => {
  const vault = await vaultWithRows();
  await openVault(page, vault);
  await inboxButton(page).click();
  await expect(row(page, 3)).toBeVisible();
  const before = await topOf(page, 3);

  // An automation leaves a proposal while the Inbox is open.
  await vault.mkdir('Inbox/Proposals');
  await vault.write('Inbox/Proposals/Send Tobias the file.md', PROPOSAL);
  await emitVaultChanged(page, ['Inbox/Proposals/Send Tobias the file.md']);
  await expect(page.getByRole('region', { name: 'Proposals' })).toBeVisible({ timeout: 10_000 });
  expect(await topOf(page, 3)).toBe(before);
});

test('an offer that never resolves: the rows show at the limit, work, and the offer comes on the next open (#130 attack)', async ({
  page,
}) => {
  const vault = await vaultWithRows();
  await vault.write('Loose idea.md', 'A thought.\n');
  const host = await openVault(page, vault);
  const release = host.holdReads('Loose idea.md');
  await inboxButton(page).click();
  // Held, not missing: drawn but not visible until the limit.
  await expect(drawnRow(page, 2)).toBeAttached();
  await expect(drawnRow(page, 2)).toBeHidden();
  await expect(row(page, 2)).toBeVisible({ timeout: 3_000 });
  await row(page, 2).click();
  await expect(page.getByText('Body of item 2.')).toBeVisible();

  release();
  await inboxButton(page).click();
  await expect(page.getByRole('region', { name: 'Tidy the vault' })).toBeVisible();
});

test('Tab pressed while the rows are held never focuses a hidden row, and a row takes focus once shown (#130 attack)', async ({
  page,
}) => {
  const vault = await vaultWithRows();
  await vault.write('Loose idea.md', 'A thought.\n');
  const host = await openVault(page, vault);
  const release = host.holdReads('Loose idea.md');
  await inboxButton(page).click();
  await expect(inboxArticle(page)).toBeVisible();
  // Drawn but held: in the page, not seen.
  await expect(drawnRow(page, 1)).toBeAttached();
  await expect(drawnRow(page, 1)).toBeHidden();
  // Not even a script's focus() lands on a held row.
  const tookFocus = await drawnRow(page, 1).evaluate((button: HTMLElement) => {
    button.focus();
    return document.activeElement === button;
  });
  expect(tookFocus).toBe(false);
  for (let n = 0; n < 8; n++) {
    await page.keyboard.press('Tab');
    const inHidden = await page.evaluate(() => {
      const active = document.activeElement;
      return active !== null && active.closest('[inert]') !== null;
    });
    expect(inHidden).toBe(false);
  }
  await expect(row(page, 1)).toBeVisible({ timeout: 3_000 });
  // Once shown, the inert is lifted: a row takes focus.
  await row(page, 1).focus();
  await expect(row(page, 1)).toBeFocused();
  release();
});

test('leaving the Inbox and coming back at once: rows still steady when the held offer lands (#130 attack)', async ({
  page,
}) => {
  const vault = await vaultWithRows();
  await vault.write('Loose idea.md', 'A thought.\n');
  await vault.write('Plan.md', '# Plan\n');
  const host = await openVault(page, vault);
  const release = host.holdReads('Loose idea.md');
  await inboxButton(page).click();
  await expect(inboxArticle(page)).toBeVisible();
  // Away and back within a frame or two.
  await page.getByRole('treeitem', { name: 'Plan', exact: true }).click();
  await inboxButton(page).click();
  await expect(row(page, 3)).toBeVisible({ timeout: 3_000 });

  release();
  expect(await largestMove(page, 'Item 3', 60)).toBe(0);
});

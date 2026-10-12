import { expect, test, type Page } from '@playwright/test';
import { dragAnnouncement } from './drag.ts';
import { createVault, installHost, sidebarSection, type FakeVault } from './host.ts';

// Adversarial probes for issue #17: the sidebar's sections share one scroller,
// and Pages' virtualised tree is placed against it with a scroll margin.

// These vaults hold hundreds of notes, each written by the test and then read
// back by the app through the stub host, a call apiece — once to open, and
// again after every change, one read queued behind another. Alone a read is
// two or three seconds; beside seven other workers one has passed twenty, and
// a starred note took 2 to 9 s to reach Favorites (24 runs, #52). The work is
// fixed, so this is a budget for it rather than a wait on a moment.
const READING_A_LARGE_VAULT = { timeout: 30_000 };
test.describe.configure({ timeout: 90_000 });

const EACH = 6;
const pad = (at: number, width = 4) => String(at).padStart(width, '0');

const typeFile = (at: number) =>
  ['---', `name: kind${pad(at, 2)}`, `label: Kind ${pad(at, 2)}`, 'properties: {}', '---', ''].join(
    '\n',
  );
const viewFile = (at: number) =>
  ['---', 'atlas: view', `type: kind${pad(at, 2)}`, 'layout: table', '---', ''].join('\n');
const dashboardFile = (at: number) =>
  ['---', 'atlas: dashboard', 'widgets: []', '---', ''].join('\n') + `# Board ${pad(at, 2)}\n`;

async function openVault(page: Page, notes: number): Promise<FakeVault> {
  const vault = await createVault();
  for (const folder of ['.atlas/types', '.atlas/views', '.atlas/dashboards', 'Zz Folder']) {
    await vault.mkdir(folder);
  }
  for (let at = 1; at <= EACH; at += 1) {
    await vault.write(`.atlas/types/kind${pad(at, 2)}.md`, typeFile(at));
    await vault.write(`.atlas/views/View ${pad(at, 2)}.md`, viewFile(at));
    await vault.write(`.atlas/dashboards/Board ${pad(at, 2)}.md`, dashboardFile(at));
  }
  for (let at = 1; at <= notes; at += 1) {
    const body = `# Note ${pad(at)}\n`;
    await vault.write(
      `Note ${pad(at)}.md`,
      at <= EACH ? `---\nfavorite: true\n---\n\n${body}` : body,
    );
  }
  for (let at = 1; at <= 5; at += 1)
    await vault.write(`Zz Folder/Inner ${at}.md`, `# Inner ${at}\n`);

  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible(READING_A_LARGE_VAULT);
  await expect(sidebarSection(page, 'favorites').locator('.sidebar__item')).toHaveCount(EACH);
  return vault;
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Vault' });
const scroller = (page: Page) => nav(page).locator('.sidebar__scroll');
const treeRow = (page: Page, name: string) =>
  sidebarSection(page, 'userSpace').getByRole('treeitem', { name, exact: true });

/**
 * Whether the tree has drawn the rows for where the scroller now is: a row
 * lies across the scroller's middle, or the middle is not over the tree.
 */
const rowsDrawnForThisScroll = (page: Page) =>
  scroller(page).evaluate((area) => {
    const shown = area.getBoundingClientRect();
    const middle = shown.top + shown.height / 2;
    const spans = (element: Element) => {
      const box = element.getBoundingClientRect();
      return box.top <= middle && middle < box.bottom;
    };
    const tree = area.querySelector('#sidebar-userSpace .tree');
    if (tree === null || !spans(tree)) return true;
    return [...tree.querySelectorAll('[role="treeitem"]')].some(spans);
  });

/**
 * Scrolls the one sidebar scroller until `name`'s tree row is on screen.
 *
 * Half a screen at a time, so no row is ever stepped over — and each step
 * waits for the tree to draw the rows it scrolled to before looking for the
 * one wanted. It used to look for 100 ms and step again: on a busy machine the
 * rows arrived later than that, the step after carried the row out of view
 * before it had been drawn, and the scroller ran to its end without it (#52).
 */
async function scrollTreeTo(page: Page, name: string) {
  const onScreen = () =>
    scroller(page).evaluate((area, label) => {
      const row = area.querySelector(`#sidebar-userSpace [role="treeitem"][aria-label="${label}"]`);
      if (row === null) return false;
      const [box, shown] = [row.getBoundingClientRect(), area.getBoundingClientRect()];
      return box.bottom > shown.top && box.top < shown.bottom;
    }, name);
  await expect(async () => {
    await expect.poll(() => rowsDrawnForThisScroll(page)).toBe(true);
    if (await onScreen()) return;
    await scroller(page).evaluate((area) => {
      area.scrollTop += area.clientHeight / 2;
    });
    throw new Error(`${name} is not on screen yet`);
  }).toPass({ intervals: [0], ...READING_A_LARGE_VAULT });
  const row = treeRow(page, name);
  await expect(row).toBeInViewport();
  return row;
}

const heading = (page: Page, name: string) => nav(page).getByRole('button', { name, exact: true });
const pagesHeading = (page: Page) => nav(page).locator('#sidebar-userSpace-heading');
const scrollTop = (page: Page) => scroller(page).evaluate((area) => area.scrollTop);

test('opening Pages leaves the sidebar scrolled where it was', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 600 });
  await openVault(page, 400);
  await heading(page, 'Pages').click();
  await scroller(page).evaluate((area) => {
    area.scrollTop = area.scrollHeight;
  });
  const before = await scrollTop(page);
  expect(before, 'the shut sidebar has somewhere to scroll').toBeGreaterThan(0);
  await expect(heading(page, 'Pages')).toBeInViewport();

  await heading(page, 'Pages').click();
  await expect(sidebarSection(page, 'userSpace').getByRole('treeitem').first()).toBeAttached();

  // The heading just clicked stays under the pointer; the tree opens below it.
  await expect.poll(() => scrollTop(page)).toBe(before);
  await expect(heading(page, 'Pages')).toBeInViewport();
});

test('a section shut while Pages is long stays within reach', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 800 });
  await openVault(page, 300);
  await expect(heading(page, 'Views')).toBeInViewport();

  await heading(page, 'Views').click();
  await expect(heading(page, 'Views')).toHaveAttribute('aria-expanded', 'false');

  // A shut section keeps its place (ADR-0013 addendum). Were it gathered below
  // the open ones, with one scroller that is below every row of the tree, and
  // the heading just clicked would vanish there.
  await expect(heading(page, 'Views')).toBeInViewport();
});

test('a tree row hidden under the sticky Pages heading is not a drop target', async ({ page }) => {
  // Tall enough that Folder 45, the row dragged, is still on screen below the
  // stuck heading however many rows the sidebar's top holds (Terms made one more).
  await page.setViewportSize({ width: 1180, height: 900 });
  const vault = await createVault();
  for (let at = 1; at <= 60; at += 1) {
    await vault.mkdir(`Folder ${pad(at, 2)}`);
    await vault.write(`Folder ${pad(at, 2)}/Inside ${pad(at, 2)}.md`, `# Inside ${at}\n`);
  }
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();

  // Folder 30 sits exactly under the stuck Pages heading.
  await scrollTreeTo(page, 'Folder 40');
  await scroller(page).evaluate((area) => {
    const stuck = area.querySelector('#sidebar-userSpace-heading')!.getBoundingClientRect();
    const row = area.querySelector('[role="treeitem"][aria-label="Folder 30"]')!;
    area.scrollTop += row.getBoundingClientRect().top - stuck.top;
  });
  const stuck = await pagesHeading(page).boundingBox();
  const held = await treeRow(page, 'Folder 45').boundingBox();
  if (stuck === null || held === null) throw new Error('nothing to drag');

  const sidebar = await nav(page).boundingBox();
  if (sidebar === null) throw new Error('no sidebar');
  await page.mouse.move(held.x + 40, held.y + 15);
  await page.mouse.down();
  await page.mouse.move(held.x + 48, held.y + 23, { steps: 4 });
  // Out over the work panel first, where nothing is a target...
  await page.mouse.move(sidebar.x + sidebar.width + 60, stuck.y + stuck.height / 2, { steps: 4 });
  await expect(dragAnnouncement(page)).toHaveText('Folder 45 is not over a folder.');

  // ...then onto the heading in one step, so that whatever is heard from
  // here on was worked out with the pointer on it.
  await page.evaluate(() => {
    const record = window as unknown as { heard: string[] };
    record.heard = [];
    new MutationObserver(() => {
      for (const region of document.querySelectorAll('[id^="DndLiveRegion"]')) {
        const text = region.textContent ?? '';
        if (text !== '') record.heard.push(text);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  const before = await scrollTop(page);
  await page.mouse.move(stuck.x + 60, stuck.y + stuck.height / 2);

  // The heading is in the scroller's top edge, so the sidebar scrolls up
  // under the held pointer, and row after row passes beneath the heading.
  await expect.poll(() => scrollTop(page)).toBeLessThan(before - 150);
  const heard = await page.evaluate(() => (window as unknown as { heard: string[] }).heard);
  await page.mouse.up();

  // A pointer on the heading is over the heading, not the rows it hides.
  expect(heard.filter((text) => /is over Folder/.test(text))).toEqual([]);
  await expect(dragAnnouncement(page)).toHaveText(
    'Folder 45 was dropped outside a folder, so it stays where it was.',
  );
  expect(await vault.exists('Folder 45/Inside 45.md')).toBe(true);
});

test('a new folder made while scrolled deep in Pages opens its name field', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 800 });
  await openVault(page, 400);
  await scrollTreeTo(page, 'Note 0300');

  await nav(page).getByRole('button', { name: 'New in Pages' }).click();
  await page.getByRole('menuitem', { name: 'New folder' }).click();

  // At the top of the sidebar this passes; deep in the tree the new row is
  // never rendered, so there is no field and typing goes nowhere.
  const field = sidebarSection(page, 'userSpace').getByRole('textbox', {
    name: 'Name for New folder',
  });
  await expect(field).toBeFocused(READING_A_LARGE_VAULT);
  await expect(field).toBeInViewport({ ratio: 1 });
});

test('starring a tree row while scrolled leaves the row under the pointer', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 800 });
  await openVault(page, 200);
  const row = await scrollTreeTo(page, 'Note 0100');
  await row.hover();
  const star = row.getByRole('button', { name: 'Add Note 0100 to favorites' });
  const aim = await star.boundingBox();
  const before = await row.boundingBox();
  if (aim === null || before === null) throw new Error('no star to click');

  await page.mouse.click(aim.x + aim.width / 2, aim.y + aim.height / 2);
  await expect(sidebarSection(page, 'favorites').locator('.sidebar__item')).toHaveCount(
    EACH + 1,
    READING_A_LARGE_VAULT,
  );

  // A second click on the same spot must reach the same star, not the row above's.
  await expect.poll(async () => (await row.boundingBox())?.y).toBe(before.y);
});

test('a rename field opens wholly below the sticky Pages heading', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 800 });
  await openVault(page, 200);
  await scrollTreeTo(page, 'Note 0100');
  // Note 0100 half under the stuck heading, its lower half still showing.
  await scroller(page).evaluate((area) => {
    const stuck = area.querySelector('#sidebar-userSpace-heading')!.getBoundingClientRect();
    const row = area.querySelector('[role="treeitem"][aria-label="Note 0100"]')!;
    area.scrollTop += row.getBoundingClientRect().top - stuck.top - 12;
  });
  const shown = await treeRow(page, 'Note 0100').boundingBox();
  if (shown === null) throw new Error('Note 0100 is not rendered');

  await page.mouse.click(shown.x + 60, shown.y + shown.height - 4, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const field = sidebarSection(page, 'userSpace').getByRole('textbox');
  await expect(field).toBeFocused();

  const stuck = await pagesHeading(page).boundingBox();
  await expect
    .poll(async () => (await field.boundingBox())?.y ?? Number.NaN)
    .toBeGreaterThanOrEqual((stuck?.y ?? 0) + (stuck?.height ?? 0));
});

import { expect, type Page } from '@playwright/test';
import { createVault, installHost, sidebarSection, type FakeVault } from '../../e2e/host.ts';
import { fixtureVault, FIXTURE_SHAPE, noteCount } from './fixture-vault.ts';
import { installProbe, measure, waitForQuiet, type Measured } from './probe.ts';

/** The fixture's notes, and the type files beside them: "2,008 notes indexed". */
const EVERY_NOTE_INDEXED = new RegExp(
  `^${Math.floor(noteCount(FIXTURE_SHAPE) / 1000)},\\d{3} notes indexed`,
);

/** Writes the fixture vault to a new folder and opens it in `page`, through the stand-in host. */
export async function openFixtureVault(page: Page): Promise<FakeVault> {
  const vault = await createVault();
  const files = fixtureVault();
  for (let start = 0; start < files.length; start += 200) {
    const batch = files.slice(start, start + 200);
    const folders = new Set(batch.map((file) => file.path.split('/').slice(0, -1).join('/')));
    await Promise.all([...folders].filter((folder) => folder !== '').map((f) => vault.mkdir(f)));
    await Promise.all(batch.map((file) => vault.write(file.path, file.contents)));
  }
  // With a manifest, as the real index has: without one every refresh re-reads all 2,000 notes.
  await installHost(page, vault, {}, { keepsManifest: true });
  await installProbe(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  // The whole vault, not the first count the status shows: measuring while it is still
  // being indexed would time the build, not the action.
  await expect(page.getByText(EVERY_NOTE_INDEXED)).toBeVisible({ timeout: 180_000 });
  await waitForQuiet(page);
  return vault;
}

/** Opens a note from the sidebar, timed until its editor is there to type in. */
export function openFromSidebar(page: Page, title: string): Promise<Measured> {
  const row = sidebarSection(page, 'userSpace').getByRole('treeitem', { name: title, exact: true });
  return measure(page, {
    act: () => row.click(),
    arg: title,
    ready: (name) =>
      document.querySelector(
        `article[aria-label="${name}"] .ProseMirror[contenteditable="true"]`,
      ) !== null,
  });
}

/** The notes of the expanded top-level folder that the tree draws now. */
const folderNotes = (page: Page) =>
  sidebarSection(page, 'userSpace').locator(
    '[role="treeitem"][aria-level="2"]:not([aria-expanded])',
  );

const namesOf = (page: Page) =>
  folderNotes(page).evaluateAll((rows) => rows.map((row) => row.getAttribute('aria-label') ?? ''));

/** Scrolls the sidebar back to its top, where the top-level folders are drawn, wherever a test left it. */
async function scrollTreeToTop(page: Page): Promise<void> {
  await sidebarSection(page, 'userSpace').evaluate((section) => {
    const around: Element[] = [...section.querySelectorAll('*')];
    for (let at: Element | null = section; at !== null; at = at.parentElement) around.push(at);
    for (const each of around) if (each.scrollTop > 0) each.scrollTop = 0;
  });
}

/** Expands one top-level folder, alone, and names the notes it shows: the tree draws only a screenful. */
export async function expandFolder(page: Page, name: string): Promise<string[]> {
  const tree = sidebarSection(page, 'userSpace');
  await scrollTreeToTop(page);
  // Drawn again from the top once the tree has heard of the scroll.
  await expect(tree.locator('[role="treeitem"][aria-level="1"]').first()).toBeVisible();
  const expanded = tree.locator('[role="treeitem"][aria-level="1"][aria-expanded="true"]');
  while ((await expanded.count()) > 0) await expanded.first().click();
  await tree.getByRole('treeitem', { name, exact: true }).click();
  await expect(folderNotes(page).first()).toBeVisible();
  return namesOf(page);
}

/** Scrolls the expanded folder on past the last note it draws, and names the notes it shows then. */
export async function scrollFolderOn(page: Page): Promise<string[]> {
  await folderNotes(page).last().scrollIntoViewIfNeeded();
  await waitForQuiet(page);
  return namesOf(page);
}

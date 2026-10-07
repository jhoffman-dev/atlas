// `pnpm shots` — screenshots the built app, on a copy of this repo's vault, for
// side-by-side comparison with the mockups (see design/README.md). Not part of
// `pnpm e2e`: it asserts nothing about behaviour, and a surface that cannot be
// found is skipped with a warning, because the shell is being restyled under it.
import { cp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import {
  createVault,
  installHost,
  sidebarSection,
  solidPng,
  type FakeHost,
  type FakeVault,
} from '../../e2e/host.ts';

const OUT = join(import.meta.dirname, '..', '..', 'design', 'out', 'shots');
const VAULT = join(import.meta.dirname, '..', '..', 'vault');
/** Where the theme choice lives — `apps/desktop/src/theme/browser-theme-store.ts`. */
const THEME_KEY = 'atlas.theme';
/** vault/tasks/A15-03.md, found by a word only its body has. */
const NOTE_WORDS = 'compileViewQuery';
// Search lists it by its `title`, not its filename.
const NOTE_TITLE = /^Leftovers from A15-02/;
/** Long enough for charts and the board to finish laying out; this is a camera, not a test. */
const SETTLE_MS = 700;

/**
 * A note holding everything the editor draws, which the repo's own vault does
 * not: a callout, a table, code, a checklist and a link. No image: the fake
 * host's binary reads do not survive the trip into the page, so one would
 * only ever photograph as broken.
 */
const SPECIMEN = [
  '# Specimen',
  '',
  'A paragraph of running text with **bold**, _emphasis_, `inline code` and a link to [[Untitled]].',
  '',
  'Tagged #design/system, #phase16 and #tag me# — tags stay text.',
  '',
  '> [!note] A callout',
  '> Callouts carry a tint and an icon, never a heavy rule.',
  '',
  '| Surface | Radius | Shadow |',
  '| ------- | ------ | ------ |',
  '| Panel   | 22     | panel  |',
  '| Card    | 16     | card   |',
  '',
  '```ts',
  'export function greet(name: string): string {',
  '  return `Hello, ${name}`; // a comment',
  '}',
  '```',
  '',
  '- [ ] Something to do',
  '- [x] Something done',
  '',
  '',
].join('\n');

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

/** A page an artifact's saved copy holds: styled, with a script, and no picture files. */
const ARTIFACT_PAGE = [
  '<!doctype html><html><head><title>Q3 sales</title><link rel="stylesheet" href="deck.css"></head>',
  '<body><main class="slide"><p class="kicker">Q3 review</p><h1>Revenue up <span id="growth">…</span></h1>',
  '<div class="bars"><i style="height:40%"></i><i style="height:55%"></i><i style="height:70%"></i><i style="height:92%"></i></div>',
  '<p>Four quarters of steady growth, led by the self-serve plan.</p></main>',
  '<script>document.getElementById("growth").textContent = "32%";</script></body></html>',
].join('');
const ARTIFACT_CSS = [
  'body{margin:0;font:16px/1.5 system-ui;background:linear-gradient(135deg,#0f2a6b,#1f6fd1);color:#fff;min-height:100vh;display:grid;place-items:center}',
  '.slide{max-width:640px;padding:48px}.kicker{text-transform:uppercase;letter-spacing:.12em;opacity:.7}',
  'h1{font-size:48px;margin:.2em 0}.bars{display:flex;gap:12px;align-items:end;height:160px;margin:24px 0}',
  '.bars i{flex:1;background:#5ee3f5;border-radius:8px 8px 0 0}',
].join('');

/** Three artifacts: two with saved copies, one with only its link. */
async function addArtifacts(vault: FakeVault): Promise<void> {
  await vault.mkdir('artifacts/q3-sales-deck');
  await vault.mkdir('artifacts/pricing-mockup');
  await vault.write('artifacts/q3-sales-deck/index.html', ARTIFACT_PAGE);
  await vault.write('artifacts/q3-sales-deck/deck.css', ARTIFACT_CSS);
  await vault.write('artifacts/pricing-mockup/index.html', '<h1>Pricing</h1>');
  const note = (fields: string, body: string) => `---\ntype: artifact\n${fields}---\n\n${body}\n`;
  await vault.write(
    'artifacts/Q3 sales deck.md',
    note(
      "url: https://claude.ai/artifact/q3-sales-deck\nkind: deck\nproject: '[[Atlas]]'\ntags: [sales, q3]\nsaved: artifacts/q3-sales-deck\nsaved_at: 2026-09-24\n",
      'Made for the board meeting; the numbers are from the September export.',
    ),
  );
  await vault.write(
    'artifacts/Pricing mockup.md',
    note(
      'url: https://claude.ai/artifact/pricing\nkind: design\ntags: [pricing]\nsaved: artifacts/pricing-mockup\nsaved_at: 2026-09-23\n',
      'Three tiers, annual toggle.',
    ),
  );
  await vault.write(
    'artifacts/Launch plan.md',
    note('url: https://claude.ai/artifact/launch-plan\nkind: doc\n', ''),
  );
}

async function prepareVault(): Promise<FakeVault> {
  const vault = await createVault();
  await cp(VAULT, vault.root, { recursive: true });
  await vault.write('Specimen.md', SPECIMEN);
  await addArtifacts(vault);
  return vault;
}

async function openVault(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible({ timeout: 30_000 });
}

/** Sets the theme through whatever toggle the shell has today, since the key was preset before load. */
async function useTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  const toggle = page
    .getByRole('switch', { name: /dark/i })
    .or(page.getByRole('button', { name: /dark theme/i }));
  const current = () => page.evaluate(() => document.documentElement.dataset['theme']);
  if ((await current()) !== theme && (await toggle.count()) > 0) await toggle.first().click();
  if ((await current()) !== theme) console.warn(`theme is ${await current()}, wanted ${theme}`);
}

async function shoot(page: Page, name: string, clip?: Locator): Promise<void> {
  await page.waitForTimeout(SETTLE_MS);
  const path = join(OUT, `${name}.png`);
  const box = clip ? await clip.boundingBox() : null;
  await page.screenshot({
    path,
    animations: 'disabled',
    ...(box ? { clip: { x: 0, y: 0, width: box.x + box.width, height: 900 } } : {}),
  });
  console.log(path);
}

/** Clicks the first locator that matches, or warns and reports false. */
async function open(surface: string, candidates: Locator[]): Promise<boolean> {
  for (const candidate of candidates) {
    if ((await candidate.count()) > 0) {
      await candidate.first().click();
      return true;
    }
  }
  console.warn(`${surface}: nothing to open it with — skipped`);
  return false;
}

/** The search palette, open, with `words` typed into it and its results in. */
async function search(page: Page, words: string): Promise<Locator> {
  // Whatever the last surface left focused — a calendar cell, a board card —
  // must not swallow the shortcut, so the palette is waited for, not assumed.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+k');
  const palette = page.getByRole('dialog', { name: /search/i });
  // A palette that does not open is reported by the caller's `open`.
  await palette.waitFor({ timeout: 3_000 }).catch(() => undefined);
  if (!(await palette.isVisible())) {
    await page
      .getByRole('navigation', { name: 'Vault' })
      .getByRole('button', { name: /^Search/ })
      .first()
      .click();
    await palette.waitFor({ timeout: 5_000 }).catch(() => undefined);
  }
  // Filled rather than typed: keystrokes sent while the palette is still taking
  // the focus land wherever the focus was, and the search never hears them.
  await palette
    .getByLabel('Search the vault')
    .fill(words)
    .catch(() => console.warn(`search: the field was not there to fill with ${words}`));
  // A search that finds nothing is reported by the caller's `open`.
  await palette
    .getByRole('option')
    .first()
    .waitFor({ timeout: 10_000 })
    .catch(() => undefined);
  return palette;
}

/** Through the search palette: the sidebar tree is virtualized, so a row may not be there. */
async function openBySearch(
  page: Page,
  { words, name }: { words: string; name: RegExp },
): Promise<boolean> {
  const palette = await search(page, words);
  if (!(await open(`${words} (search)`, [palette.getByRole('option', { name })]))) {
    await page.keyboard.press('Escape');
    return false;
  }
  // The page is up once its heading is; the camera waits for that state.
  await page
    .getByLabel('Note', { exact: true })
    .getByRole('heading', { level: 1 })
    .first()
    .waitFor({ timeout: 10_000 })
    .catch(() => console.warn(`${words}: opened, but its page never showed`));
  return true;
}

function view(page: Page, name: string): Locator[] {
  return [
    sidebarSection(page, 'views').getByRole('button', { name, exact: true }),
    page.getByRole('navigation').getByRole('button', { name, exact: true }),
  ];
}

async function shootViews(page: Page, theme: string): Promise<void> {
  const dashboards = sidebarSection(page, 'dashboards');
  if (await open('dashboard', [dashboards.getByRole('button', { name: 'Progress', exact: true })]))
    await shoot(page, `dashboard-${theme}`);
  if (await open('board', view(page, 'Board'))) {
    await shoot(page, `board-${theme}`);
    const toolbar = page.locator('.view-toolbar');
    if (await open('filter', [toolbar.getByRole('button', { name: /^Filter/ })])) {
      await shoot(page, `filter-${theme}`);
      await page.keyboard.press('Escape');
    }
  }
  if (await open('all-tasks', view(page, 'All tasks'))) {
    await shoot(page, `all-tasks-${theme}`);
    // Scrolled to the last row: the header should still be at the top of the sheet.
    await page.locator('.table__sheet').evaluate((sheet) => sheet.scrollTo(0, sheet.scrollHeight));
    await shoot(page, `all-tasks-scrolled-${theme}`);
  }
  if (await open('calendar', view(page, 'Calendar'))) await shoot(page, `calendar-${theme}`);
  if (await open('timeline', view(page, 'Roadmap'))) await shoot(page, `timeline-${theme}`);
  const inbox = page.getByRole('navigation', { name: 'Vault' }).getByRole('button', {
    name: /^Inbox/,
  });
  if (await open('list', [inbox])) await shoot(page, `list-${theme}`);
  const types = sidebarSection(page, 'types');
  if (await open('type', [types.getByRole('button', { name: /^Task, / })])) {
    await shoot(page, `type-${theme}`);
    // One row lit: the type, not the note last opened before it.
    await shoot(page, `sidebar-type-${theme}`, page.getByRole('navigation', { name: 'Vault' }));
  }
}

/**
 * All tasks drawn every way the Layout menu offers (P17-05), switched from the
 * menu itself as a person would — on the copy of the vault, so nothing real
 * changes — and put back to a table afterwards.
 */
async function shootLayouts(page: Page, theme: string): Promise<void> {
  if (!(await open('layouts', view(page, 'All tasks')))) return;
  const choose = async (layout: string): Promise<boolean> => {
    if (!(await open('layout menu', [page.getByRole('button', { name: 'Layout', exact: true })]))) {
      return false;
    }
    const item = page.getByRole('menuitemradio', { name: new RegExp(`^${layout}`) });
    await item.waitFor({ timeout: 5_000 });
    await item.click();
    await page.locator(`.view-toolbar [data-layout="${layout.toLowerCase()}"]`).waitFor();
    return true;
  };

  const trigger = page.getByRole('button', { name: 'Layout', exact: true });
  // The view's toolbar is drawn once its query has run.
  await trigger.waitFor({ timeout: 10_000 }).catch(() => undefined);
  if (await open('layout menu', [trigger])) {
    await shoot(page, `layout-menu-${theme}`);
    await page.keyboard.press('Escape');
  }
  for (const layout of ['Feed', 'Gallery', 'List']) {
    if (await choose(layout)) await shoot(page, `layout-${layout.toLowerCase()}-${theme}`);
  }
  await choose('Table');
}

async function shootNotes(page: Page, theme: string): Promise<void> {
  if (await openBySearch(page, { words: NOTE_WORDS, name: NOTE_TITLE }))
    await shoot(page, `note-${theme}`);
  if (await openBySearch(page, { words: 'Callouts', name: /^Specimen/ })) {
    await shoot(page, `specimen-${theme}`);
    await shootEditorPopups(page, theme);
  }
  if (await openBySearch(page, { words: 'milestone', name: /Sources/ }))
    await shoot(page, `source-${theme}`);
  // An ADR with no `title`, listed by the heading it opens with.
  if (await openBySearch(page, { words: 'widget query drawing', name: /widget is a query/i }))
    await shoot(page, `adr-${theme}`);
}

/** The slash menu and the wikilink suggestions, typed at the end of the specimen. */
async function shootEditorPopups(page: Page, theme: string): Promise<void> {
  const editor = page.locator('.ProseMirror').first();
  if ((await editor.count()) === 0) return console.warn('editor: not found — popups skipped');
  await editor.click();
  await page.keyboard.press('Meta+ArrowUp');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.type('/');
  await shoot(page, `slash-${theme}`);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('[[Unt');
  await shoot(page, `wikilink-${theme}`);
  await page.keyboard.press('Escape');
  for (let typed = 0; typed < '[[Unt'.length; typed += 1) await page.keyboard.press('Backspace');
  await page.keyboard.type('#de');
  await shoot(page, `tag-suggest-${theme}`);
  await page.keyboard.press('Escape');
}

/** The tags page, on the specimen's nested tag, then its rename preview. */
async function shootTags(page: Page, theme: string): Promise<void> {
  await page.keyboard.press('Escape');
  const tagsRow = page.getByRole('list', { name: 'Go to' }).getByRole('button', { name: 'Tags' });
  if (!(await open('tags', [tagsRow]))) return;
  const tree = page.getByRole('list', { name: 'Tags', exact: true });
  if (!(await open('a tag', [tree.getByRole('button', { name: /^system \d/ })]))) return;
  await shoot(page, `tags-${theme}`);
  await page.getByRole('button', { name: 'Rename' }).click();
  await page.getByLabel('New name').fill('design/tokens');
  await page.getByRole('button', { name: 'Preview' }).click();
  await page.getByText(/will become/).waitFor({ timeout: 5_000 });
  await shoot(page, `tags-rename-${theme}`);
}

async function shootOverlays(page: Page, theme: string): Promise<void> {
  const palette = await search(page, 'view');
  if (await palette.isVisible()) await shoot(page, `search-${theme}`);
  else console.warn('search: the palette did not open — skipped');
  await page.keyboard.press('Escape');

  await page.keyboard.press('Shift+Meta+n');
  const capture = page.getByRole('dialog', { name: /capture/i });
  // A palette that never opens is warned about just below.
  await capture.waitFor({ timeout: 3_000 }).catch(() => undefined);
  if (await capture.isVisible()) await shoot(page, `capture-${theme}`);
  else console.warn('capture: the palette did not open — skipped');
  await page.keyboard.press('Escape');

  if (await open('new-note', [page.getByRole('button', { name: 'New note', exact: true })])) {
    await shoot(page, `new-note-${theme}`);
    await page.keyboard.press('Escape');
  }
  if (await open('settings', [page.getByRole('button', { name: 'Settings', exact: true })])) {
    await shoot(page, `settings-${theme}`);
    await shootProfile(page, theme);
    await page.keyboard.press('Escape');
  }
}

/** Settings → Profile with no name, then with one; the name is cleared again after. */
async function shootProfile(page: Page, theme: string): Promise<void> {
  const profile = page.getByRole('region', { name: 'Profile' });
  if ((await profile.count()) === 0) {
    console.warn('profile: no Profile section in Settings');
    return;
  }
  const name = profile.getByRole('textbox', { name: 'Full name' });
  await profile.scrollIntoViewIfNeeded();
  await page.waitForTimeout(SETTLE_MS);
  await profile.screenshot({
    path: join(OUT, `profile-empty-${theme}.png`),
    animations: 'disabled',
  });
  await name.fill('James Hoffman');
  await name.press('Enter');
  await profile.getByText('What Claude writes for you').waitFor();
  await page.waitForTimeout(SETTLE_MS);
  await profile.screenshot({ path: join(OUT, `profile-${theme}.png`), animations: 'disabled' });
  await name.fill('');
  await name.press('Enter');
  await profile.getByText(/Not set/).waitFor();
}

/** Pages' row menu, and the folder picker and the delete question it opens — nothing is moved or deleted. */
async function shootPages(page: Page, theme: string): Promise<void> {
  await page.keyboard.press('Escape');
  const pages = sidebarSection(page, 'userSpace');
  const folder = pages.getByRole('treeitem', { name: 'docs', exact: true });
  if ((await folder.count()) === 0) return console.warn('pages: no docs folder — skipped');
  const menu = async (): Promise<boolean> => {
    await folder.hover();
    return open('row menu', [pages.getByRole('button', { name: 'Options for docs' })]);
  };
  if (!(await menu())) return;
  await shoot(page, `pages-menu-${theme}`);
  if (await open('move picker', [page.getByRole('menuitem', { name: /^Move to…/ })])) {
    await page.getByRole('dialog', { name: /^Move docs to/ }).waitFor({ timeout: 5_000 });
    await shoot(page, `move-picker-${theme}`);
    await page.keyboard.press('Escape');
  }
  if (!(await menu())) return;
  if (await open('delete dialog', [page.getByRole('menuitem', { name: /^Delete…/ })])) {
    await page.getByRole('alertdialog').waitFor({ timeout: 5_000 });
    await shoot(page, `delete-dialog-${theme}`);
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
  }
}

/** The graph of the whole vault, the graph around one note, and a note's Links opened (P17-06). */
async function shootGraph(page: Page, theme: string): Promise<void> {
  await page.keyboard.press('Escape');
  const graphRow = page.getByRole('list', { name: 'Go to' }).getByRole('button', { name: 'Graph' });
  if (await open('graph', [graphRow])) {
    await page.locator('.graph__node').first().waitFor({ timeout: 10_000 });
    await shoot(page, `graph-${theme}`);
  }
  if (!(await openBySearch(page, { words: 'documents', name: /^Atlas/ }))) return;
  const links = page.getByRole('region', { name: 'Links', exact: true });
  await links.getByRole('button', { name: /^Links/ }).click();
  await links.scrollIntoViewIfNeeded();
  await shoot(page, `links-${theme}`);
  await page.getByRole('button', { name: 'More' }).first().click();
  const showInGraph = page.getByRole('menuitem', { name: /^Show in graph/ });
  // A menu that never shows is reported by `open` below, as a skipped surface.
  await showInGraph.waitFor({ timeout: 5_000 }).catch(() => undefined);
  if (await open('local graph', [showInGraph])) {
    await page.locator('.graph__node--centre').waitFor({ timeout: 10_000 });
    await shoot(page, `graph-local-${theme}`);
  }
}

async function shootSplit(page: Page, theme: string): Promise<void> {
  if (!(await open('split board', view(page, 'Board')))) return;
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+Meta+\\');
  await shoot(page, `split-${theme}`);
  await page.keyboard.press('Shift+Meta+\\');
}

/** New artifact with a pasted link, an artifact's note with its copy, and the gallery. */
async function shootArtifacts(page: Page, theme: string): Promise<void> {
  await page.keyboard.press('Escape');
  const palette = await search(page, 'https://claude.ai/artifact/9c2f-onboarding-flow');
  if (await open('new artifact', [palette.getByRole('option', { name: /as an artifact/ })])) {
    const dialog = page.getByRole('dialog', { name: 'New artifact' });
    await dialog.getByRole('textbox', { name: 'Title' }).fill('Onboarding flow');
    await shoot(page, `new-artifact-${theme}`);
    await page.keyboard.press('Escape');
  }
  if (await openBySearch(page, { words: 'board meeting September', name: /Q3 sales deck/ })) {
    await page
      .frameLocator('iframe[title="Saved copy of Q3 sales deck"]')
      .getByText('32%')
      .waitFor({ timeout: 10_000 })
      .catch(() => console.warn('artifact: the saved copy never drew'));
    await shoot(page, `artifact-note-${theme}`);
  }
  if (await open('artifacts gallery', view(page, 'Artifacts'))) {
    await shoot(page, `artifacts-gallery-${theme}`);
  }
}

/**
 * The Archive (U-22): a page's menu offering Archive, the Archive page after
 * two notes are put away, and search reaching them with Include archived. It
 * archives notes, so it runs on a vault of its own, after the other shots.
 */
async function shootArchive(page: Page, theme: string): Promise<void> {
  const archiveRow = sidebarSection(page, 'userSpace').getByRole('treeitem', { name: 'Archive' });
  if (!(await openBySearch(page, { words: 'Callouts carry a tint', name: /Specimen/ }))) return;
  await page.getByRole('button', { name: 'More' }).first().click();
  const archive = page.getByRole('menuitem', { name: /^Archive$/ });
  await archive.waitFor({ timeout: 5_000 });
  await shoot(page, `archive-action-${theme}`);
  await archive.click();
  await archiveRow.waitFor({ timeout: 10_000 });
  // A second note, archived from the palette, so the Archive lists more than one.
  if (await openBySearch(page, { words: 'board meeting September', name: /Q3 sales deck/ })) {
    const palette = await search(page, 'archive this');
    await open('archive command', [palette.getByRole('option', { name: /Archive this note/ })]);
  }

  await archiveRow.click();
  await page.getByRole('article', { name: 'Archive' }).getByRole('row').nth(1).waitFor();
  await shoot(page, `archive-view-${theme}`);

  const palette = await search(page, 'callout');
  await palette.getByRole('switch', { name: 'Include archived' }).click();
  await palette.getByRole('option', { name: /Specimen/ }).waitFor({ timeout: 10_000 });
  await shoot(page, `archive-search-${theme}`);
  await page.keyboard.press('Escape');
}

for (const theme of ['light', 'dark'] as const) {
  test(`shots, ${theme}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
      key: THEME_KEY,
      value: theme,
    });
    const vault = await prepareVault();
    await installHost(page, vault);
    await page.goto('/');
    await shoot(page, `welcome-${theme}`);
    await openVault(page);
    await useTheme(page, theme);

    await shoot(page, `empty-${theme}`);
    await shoot(page, `sidebar-${theme}`, page.getByRole('navigation', { name: 'Vault' }));
    await shootViews(page, theme);
    await shootLayouts(page, theme);
    await shootNotes(page, theme);
    await shootSplit(page, theme);
    await shootOverlays(page, theme);
    await shootPages(page, theme);
    await shootGraph(page, theme);
    await shootTags(page, theme);
    await shootArtifacts(page, theme);
  });
}

/**
 * P24: an Atlas query in the builder, the same query as text with a mistake
 * pointed at, and a saved query grouped then sub-grouped.
 */
async function shootQueries(page: Page, theme: string): Promise<void> {
  await page.getByRole('button', { name: 'New in Views' }).click();
  await page.getByRole('menuitem', { name: 'New query' }).click();
  const modes = page.getByRole('radiogroup', { name: 'Edit the query as' });
  const editor = page.getByRole('textbox', { name: 'Query' });
  await modes.getByRole('radio', { name: 'Text' }).click();
  await editor.fill(
    'FROM task, project WHERE status != done AND title CONTAINS e SORT BY phase DESC GROUP BY type THEN status',
  );
  await modes.getByRole('radio', { name: 'Builder' }).click();
  await page.locator('.qresult__title').first().waitFor({ timeout: 10_000 });
  await shoot(page, `query-builder-${theme}`);

  await modes.getByRole('radio', { name: 'Text' }).click();
  await editor.fill('FROM task WHERE stauts != done GROUP BY phase THEN status');
  await page.getByRole('alert').waitFor({ timeout: 10_000 });
  await shoot(page, `query-text-error-${theme}`);

  await editor.fill('FROM task WHERE status != done SORT BY title GROUP BY phase THEN status');
  await page.getByRole('button', { name: 'Save as view' }).click();
  await page.getByRole('textbox', { name: 'View name' }).fill(`Open by phase ${theme}`);
  await page.getByRole('button', { name: 'Save view' }).click();
  const grouped = page.locator('.qresult').first();
  await grouped.waitFor({ timeout: 10_000 });
  // The groups, not the builder above them, are what this shot is of.
  await page
    .getByRole('radiogroup', { name: 'Edit the query as' })
    .getByRole('radio', { name: 'Text' })
    .click();
  await grouped.scrollIntoViewIfNeeded();
  await shoot(page, `query-view-grouped-${theme}`);
  await page
    .getByRole('radiogroup', { name: 'Layout' })
    .getByRole('radio', { name: 'Board' })
    .click();
  await shoot(page, `query-view-board-${theme}`);
}

for (const theme of ['light', 'dark'] as const) {
  test(`query shots, ${theme}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
      key: THEME_KEY,
      value: theme,
    });
    const vault = await prepareVault();
    await installHost(page, vault);
    await page.goto('/');
    await openVault(page);
    await useTheme(page, theme);
    await shootQueries(page, theme);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`archive shots, ${theme}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
      key: THEME_KEY,
      value: theme,
    });
    const vault = await prepareVault();
    await installHost(page, vault);
    await page.goto('/');
    await openVault(page);
    await useTheme(page, theme);
    await shootArchive(page, theme);
  });
}

/** Tasks in areas, for a table grouped then sub-grouped and a board with swimlanes (issue #6). */
async function groupsVault(): Promise<FakeVault> {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('.atlas/views');
  await vault.write(
    '.atlas/types/task.md',
    [
      '---',
      'name: task',
      'properties:',
      '  status:',
      '    kind: select',
      '    options: [backlog, doing, review, done]',
      '  area:',
      '    kind: select',
      '    options: [home, work, garden]',
      '  hours: number',
      '  urgent: checkbox',
      '---',
      '',
    ].join('\n'),
  );
  const shown = 'columns: [status, area, hours, urgent]';
  const viewNote = (name: string, layout: string) =>
    [
      '---',
      'atlas: view',
      'type: task',
      layout,
      'groupBy: status',
      'subGroupBy: area',
      shown,
      'limit: 100',
      '---',
      '',
      `# ${name}`,
      '',
    ].join('\n');
  await vault.write('.atlas/views/Grouped.md', viewNote('Grouped', 'layout: table'));
  await vault.write('.atlas/views/Swimlanes.md', viewNote('Swimlanes', 'layout: board'));
  const tasks: readonly [string, string, string, number, boolean][] = [
    ['Fix the gate latch', 'backlog', 'home', 2, false],
    ['Order seed potatoes', 'backlog', 'garden', 1, true],
    ['Draft the Q4 plan', 'doing', 'work', 6, true],
    ['Review the API keys', 'doing', 'work', 3, false],
    ['Paint the hallway', 'doing', 'home', 8, false],
    ['Prune the apple tree', 'doing', 'garden', 3, false],
    ['Hiring loop notes', 'review', 'work', 2, true],
    ['Book the boiler service', 'done', 'home', 1, false],
    ['Ship the release notes', 'done', 'work', 4, false],
  ];
  for (const [title, status, area, hours, urgent] of tasks) {
    await vault.write(
      `${title}.md`,
      [
        '---',
        'type: task',
        `status: ${status}`,
        `area: ${area}`,
        `hours: ${hours}`,
        `urgent: ${urgent}`,
        '---',
        '',
        `# ${title}`,
        '',
      ].join('\n'),
    );
  }
  return vault;
}

async function shootGroups(page: Page, theme: string): Promise<void> {
  if (await open('grouped table', view(page, 'Grouped'))) {
    await page.locator('.table__group').first().waitFor({ timeout: 10_000 });
    // One sub-group folded, to show a folded header beside open ones.
    await page
      .locator('.table__group-toggle[data-depth="1"]')
      .filter({ hasText: /^Garden/ })
      .first()
      .click();
    await shoot(page, `groups-table-${theme}`);
  }
  if (await open('swimlanes', view(page, 'Swimlanes'))) {
    await page.locator('.board__lane').first().waitFor({ timeout: 10_000 });
    await shoot(page, `groups-board-${theme}`);
  }
}

for (const theme of ['light', 'dark'] as const) {
  test(`group shots, ${theme}`, async ({ page }) => {
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
      key: THEME_KEY,
      value: theme,
    });
    const vault = await groupsVault();
    await installHost(page, vault);
    await page.goto('/');
    await openVault(page);
    await useTheme(page, theme);
    await shootGroups(page, theme);
  });
}

/** A note with bookmarks (U-21): one with a picture and a summary, one archived, one missing. */
async function bookmarkVault(): Promise<FakeVault> {
  const vault = await createVault();
  await vault.mkdir('Trips');
  await vault.mkdir('Archive');
  await vault.write(
    'Summer.md',
    [
      '# Summer',
      '',
      'Where we are going, and what we still have to book. See [[Oslo]] for last year.',
      '',
      '[[Rome in May]] <!-- atlas:bookmark -->',
      '',
      '[[Oslo]] <!-- atlas:bookmark -->',
      '',
      '[[Lisbon]] <!-- atlas:bookmark -->',
      '',
    ].join('\n'),
  );
  await vault.write(
    'Trips/Rome in May.md',
    '---\ncover: rome.png\ndescription: Ten days, three cities and one very long lunch — the plan, the tickets and the list of places Julie wants to see.\n---\n\nThe body.\n',
  );
  await writeFile(join(vault.root, 'Trips', 'rome.png'), solidPng(320, 200, [214, 120, 64]));
  await vault.write('Archive/Oslo.md', '# Oslo\n\nCold, dark by four, and worth every minute.\n');
  return vault;
}

async function shootBookmarks(page: Page, theme: string): Promise<void> {
  await page.getByRole('treeitem', { name: 'Summer', exact: true }).click();
  const card = page.getByRole('group', { name: /^Bookmark: Rome in May/ });
  await card.waitFor({ timeout: 10_000 });
  await shoot(page, `bookmark-${theme}`);
  await card.hover();
  await card.getByRole('button', { name: /^Options for / }).click();
  await page.getByRole('menuitem', { name: 'Show as link' }).waitFor({ timeout: 5_000 });
  await shoot(page, `bookmark-menu-${theme}`);
  await page.keyboard.press('Escape');
  await page.locator('.editor p [data-wikilink="Oslo"]').hover();
  await page.getByRole('button', { name: 'Link options' }).last().click();
  await page.getByRole('menuitem', { name: 'Show as bookmark' }).waitFor({ timeout: 5_000 });
  await shoot(page, `link-menu-${theme}`);
  await page.keyboard.press('Escape');
}

for (const theme of ['light', 'dark'] as const) {
  test(`bookmark shots, ${theme}`, async ({ page }) => {
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
      key: THEME_KEY,
      value: theme,
    });
    const vault = await bookmarkVault();
    await installHost(page, vault);
    await page.goto('/');
    await openVault(page);
    await useTheme(page, theme);
    await shootBookmarks(page, theme);
  });
}

/** A note showing blocks of another (P26): live ones, an archived one, and one whose block is gone. */
async function blockEmbedVault(): Promise<FakeVault> {
  const vault = await createVault();
  await vault.mkdir('Archive');
  await vault.write(
    'Trip plan.md',
    [
      '# Trip plan',
      '',
      'Ten days, three cities, and one very long lunch in Rome. ^lunch1',
      '',
      '## Packing',
      '',
      '- [ ] Pack the tent and the pegs ^tent01',
      '- [x] Book the night train to Vienna',
      '- [ ] Ask Julie about the museums she wants to see',
      '',
      '> [!note] Tickets',
      '> Print them — the station machines only take cards.',
      '',
    ].join('\n'),
  );
  await vault.write(
    'Archive/Last summer.md',
    '# Last summer\n\nCold, dark by four, and worth it. ^cold01\n',
  );
  await vault.write(
    'Journal.md',
    [
      '# Journal',
      '',
      'What we settled on today:',
      '',
      '![[Trip plan#^lunch1]]',
      '',
      '![[Trip plan#^tent01]]',
      '',
      '![[Last summer#^cold01]]',
      '',
      '![[Trip plan#^gone99]]',
      '',
      '',
    ].join('\n'),
  );
  return vault;
}

async function shootBlockEmbeds(page: Page, theme: string): Promise<void> {
  await page.getByRole('treeitem', { name: 'Journal', exact: true }).click();
  const shown = page.getByRole('group', { name: 'Embedded block from Trip plan' }).first();
  await shown.getByLabel('Embedded block', { exact: true }).waitFor({ timeout: 10_000 });
  await page.waitForTimeout(SETTLE_MS);
  await shoot(page, `block-embed-${theme}`);
  // The picker: `![[`, a note, then its headings and blocks.
  await page.getByLabel('Note', { exact: true }).getByText('What we settled on today:').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('![[Trip');
  await page.getByRole('listbox', { name: 'Link to note' }).waitFor({ timeout: 5_000 });
  await page.keyboard.press('Enter');
  await page.getByRole('listbox', { name: 'Link to block' }).waitFor({ timeout: 5_000 });
  await shoot(page, `block-picker-${theme}`);
  await page.keyboard.press('Escape');
}

for (const theme of ['light', 'dark'] as const) {
  test(`block embed shots, ${theme}`, async ({ page }) => {
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
      key: THEME_KEY,
      value: theme,
    });
    const vault = await blockEmbedVault();
    await installHost(page, vault);
    await page.goto('/');
    await openVault(page);
    await useTheme(page, theme);
    await shootBlockEmbeds(page, theme);
  });
}

/** U-28: a vault with one automation to run, and earlier lines in its Activity log. */
async function activityVault(): Promise<FakeVault> {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('.atlas/automations');
  await vault.mkdir('Tasks');
  await vault.mkdir('Sources');
  await vault.mkdir('Projects');
  await vault.write(
    '.atlas/types/task.md',
    '---\nname: task\nproperties:\n  status:\n    kind: select\n    options: [doing, done]\n---\n',
  );
  await vault.write(
    '.atlas/automations/Tidy tasks.md',
    '---\natlas: automation\nname: Tidy tasks\nenabled: true\nwhen: manually\nwhich: FROM task WHERE status = done\ndo: archive\nid: Tidy tasks\n---\n',
  );
  await vault.write('Tasks/Ship the log.md', '---\ntype: task\nstatus: done\n---\n');
  await vault.write('Projects/Atlas.md', '# Atlas\n');
  await vault.write('Sources/GitHub issues.md', '# GitHub issues\n');
  return vault;
}

/** Earlier lines, of every kind and level, as a past session kept them. */
function earlierActivity(): string {
  const now = Date.now();
  const hour = 3_600_000;
  const line = (
    ago: number,
    level: string,
    kind: string,
    message: string,
    subject: { kind: string; path: string } | null = null,
  ) => `${JSON.stringify({ at: now - ago * hour, level, kind, message, subject })}\n`;
  const atlas = { kind: 'note', path: 'Projects/Atlas.md' };
  const github = { kind: 'source', path: 'Sources/GitHub issues.md' };
  const tidy = { kind: 'rule', path: '.atlas/automations/Tidy tasks.md' };
  return [
    line(40, 'info', 'index', 'Rebuilt the index: 412 notes.'),
    line(30, 'info', 'source', 'GitHub issues: Refreshed. 38 records, 3 new, 5 updated.', github),
    line(26, 'error', 'source', 'GitHub issues: Refresh failed. HTTP 502 from the server.', github),
    line(5, 'info', 'api', 'PATCH v1/notes/{path}/properties — Atlas', atlas),
    line(4, 'warning', 'api', 'PUT v1/notes/{path}/body refused for Atlas (conflict).', atlas),
    line(2, 'info', 'chat', 'Edited Atlas, as Claude proposed.', atlas),
    line(
      1,
      'warning',
      'automation',
      'Tidy tasks: Ran on schedule. Archived 2 notes. Left 1 alone.',
      tidy,
    ),
  ].join('');
}

async function shootActivity(page: Page, theme: string, host: FakeHost): Promise<void> {
  const goTo = page.getByRole('list', { name: 'Go to' });
  // A run by hand, and a create that fails: a line each, and a red notice.
  await goTo.getByRole('button', { name: 'Automations', exact: true }).click();
  await page.getByRole('button', { name: 'Run Tidy tasks now' }).click();
  // The run writes its own log; the failure is meant for the note made after it.
  await page
    .getByText(/Archived 1 note/)
    .first()
    .waitFor();
  host.failNext('create_note', 'the disk is full');
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('menuitem', { name: 'Blank note' }).click();
  await goTo.getByRole('button', { name: /^Activity, \d+ new errors?$/ }).waitFor();
  await shoot(page, `activity-badge-${theme}`);
  await goTo.getByRole('button', { name: /^Activity/ }).click();
  await page.getByRole('list', { name: 'Activity lines' }).waitFor();
  await shoot(page, `activity-${theme}`);
  await page.getByRole('radio', { name: 'Errors only' }).click();
  await shoot(page, `activity-errors-${theme}`);
}

for (const theme of ['light', 'dark'] as const) {
  test(`activity shots, ${theme}`, async ({ page }) => {
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
      key: THEME_KEY,
      value: theme,
    });
    const vault = await activityVault();
    const host = await installHost(page, vault);
    host.seedActivity(vault.root, earlierActivity());
    await page.goto('/');
    await openVault(page);
    await useTheme(page, theme);
    await shootActivity(page, theme, host);
  });
}

/**
 * Issue #11: a type opened from the sidebar, on its views as tabs — the repo's
 * Task, which has several — with "+" and the selected tab's options open.
 */
async function shootTypeViews(page: Page, theme: string): Promise<void> {
  const types = sidebarSection(page, 'types');
  if (!(await open('type views', [types.getByRole('button', { name: /^Task, / })]))) return;
  const tabs = page.getByRole('navigation', { name: 'Views' });
  await tabs.locator('.view-tabs__tab[aria-pressed="true"]').waitFor({ timeout: 10_000 });
  await shoot(page, `type-views-${theme}`);
  await tabs.getByRole('button', { name: 'Add a view' }).click();
  await page.getByRole('menu', { name: 'Add a view' }).waitFor({ timeout: 5_000 });
  await shoot(page, `type-views-add-${theme}`);
  await page.keyboard.press('Escape');
  await tabs.getByRole('button', { name: 'View options' }).click();
  await page.getByRole('menu', { name: 'View options' }).waitFor({ timeout: 5_000 });
  await shoot(page, `type-views-options-${theme}`);
  await page.keyboard.press('Escape');
}

for (const theme of ['light', 'dark'] as const) {
  test(`type views shots, ${theme}`, async ({ page }) => {
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
      key: THEME_KEY,
      value: theme,
    });
    await installHost(page, await prepareVault());
    await page.goto('/');
    await openVault(page);
    await useTheme(page, theme);
    await shootTypeViews(page, theme);
  });
}

/**
 * Issue #16, ADR-0026: the Templates page, its New template form, a type's
 * Edit template beside its tabs, and a template open under its band.
 */
async function shootTemplates(page: Page, theme: string): Promise<void> {
  await page
    .getByRole('list', { name: 'Go to' })
    .getByRole('button', { name: 'Templates', exact: true })
    .click();
  const list = page.getByRole('article', { name: 'Templates' });
  await list.getByRole('row').nth(1).waitFor();
  await shoot(page, `templates-page-${theme}`);
  await list.getByRole('button', { name: 'New template' }).click();
  await page.getByRole('form', { name: 'New template' }).waitFor();
  await shoot(page, `templates-new-${theme}`);
  await page
    .getByRole('form', { name: 'New template' })
    .getByRole('button', { name: 'Cancel' })
    .click();

  await sidebarSection(page, 'types')
    .getByRole('button', { name: /^Person, / })
    .click();
  await page
    .getByRole('button', { name: 'Edit Person template' })
    .or(page.getByRole('button', { name: 'Edit template' }))
    .first()
    .waitFor();
  await shoot(page, `templates-type-${theme}`);
  await page
    .getByRole('button', { name: 'Edit Person template' })
    .or(page.getByRole('button', { name: 'Edit template' }))
    .first()
    .click();
  await page.getByRole('complementary', { name: 'Template' }).waitFor();
  await shoot(page, `templates-editing-${theme}`);
}

for (const theme of ['light', 'dark'] as const) {
  test(`templates shots, ${theme}`, async ({ page }) => {
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
      key: THEME_KEY,
      value: theme,
    });
    await installHost(page, await prepareVault());
    await page.goto('/');
    await openVault(page);
    await useTheme(page, theme);
    await shootTemplates(page, theme);
  });
}

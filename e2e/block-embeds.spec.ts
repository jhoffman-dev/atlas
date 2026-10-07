import { expect, test, type Page } from '@playwright/test';
import {
  createVault,
  emitVaultChanged,
  expectFile,
  expectSaved,
  installHost,
  saveNow,
  sidebarSection,
  splitWindow,
  type FakeVault,
} from './host.ts';

/**
 * Block transclusion (U-25, Phase 26): `![[` picks a note, `#` its blocks;
 * the block picked gets an id in its own note — the only change to that
 * file — and is shown live where it was linked, follows edits to its note,
 * opens its note at the block, and follows its note through a rename.
 */

const PLANS = '# Plans\n\nThe summer, roughly.\n\n* Pack the tent\n*  Book the train\n';

async function openVault(page: Page): Promise<FakeVault> {
  const vault = await createVault();
  await vault.write('Plans.md', PLANS);
  await vault.write('Journal.md', '# Journal\n\nToday.\n');
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

const pages = (page: Page) => sidebarSection(page, 'userSpace');
const pane = (page: Page, which: 1 | 2) => page.getByRole('region', { name: `Pane ${which}` });

async function openNote(page: Page, name: string, scope = page.locator('body')) {
  await pages(page).getByRole('treeitem', { name, exact: true }).click();
  await expect(scope.getByRole('article', { name })).toBeVisible();
}

/** Types `![[Pla`, picks Plans, then its block that says `words`. */
async function embedBlockOfPlans(page: Page, words: string) {
  await page.getByLabel('Note', { exact: true }).getByText('Today.').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('![[Pla');
  const notes = page.getByRole('listbox', { name: 'Link to note' });
  await notes.getByRole('option', { name: /^Plans/ }).waitFor();
  await page.keyboard.press('Enter');
  // Capacities-style: the note's headings and blocks come next, each a line of what it says.
  const blocks = page.getByRole('listbox', { name: 'Link to block' });
  await expect(blocks.getByRole('option', { name: /The summer, roughly\./ })).toBeVisible();
  await expect(blocks.getByRole('option', { name: /Plans\s*Heading 1/ })).toBeVisible();
  await page.keyboard.type(words.slice(0, 4));
  await expect(blocks.getByRole('option')).toHaveCount(1);
  await expect(blocks.getByRole('option').first()).toContainText(words);
  await page.keyboard.press('Enter');
}

test('a block linked with ![[ then # is shown live, follows its note, opens there, and survives a rename', async ({
  page,
}) => {
  const vault = await openVault(page);
  await openNote(page, 'Journal');
  await embedBlockOfPlans(page, 'Pack the tent');

  // The block got an id in its own note, and nothing else there changed.
  await expectFile(vault, 'Plans.md').toMatch(
    /^# Plans\n\nThe summer, roughly\.\n\n\* Pack the tent \^[a-z0-9]{6}\n\* {2}Book the train\n$/,
  );
  const id = /\^([a-z0-9]{6})/.exec(await vault.read('Plans.md'))?.[1] ?? '';
  expect(id).toMatch(/^[a-z0-9]{6}$/);

  // Shown in place, live, as a block of its own.
  const shown = page.getByRole('group', { name: 'Embedded block from Plans' });
  await expect(shown).toBeVisible();
  await expect(shown.getByLabel('Embedded block', { exact: true })).toHaveText('Pack the tent');
  await saveNow(page);
  await expectSaved(page);
  await expectFile(vault, 'Journal.md').toBe(`# Journal\n\nToday.\n\n![[Plans#^${id}]]\n`);

  // Edited in its own note, in the other pane: the embed follows.
  await splitWindow(page);
  await openNote(page, 'Plans', pane(page, 2));
  await pane(page, 2).getByLabel('Note', { exact: true }).getByText('Pack the tent').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' and pegs');
  await saveNow(page, pane(page, 2));
  // An edited list is written afresh (A21-01); its id stays on its item.
  await expectFile(vault, 'Plans.md').toContain(` Pack the tent and pegs ^${id}\n`);
  // The host's watcher reports the write, as it reports any change to the vault.
  await emitVaultChanged(page, ['Plans.md']);
  await expect(pane(page, 1).getByLabel('Embedded block', { exact: true })).toHaveText(
    'Pack the tent and pegs',
  );

  // Edited by another app: the embed follows that too.
  await vault.write('Plans.md', PLANS.replace('Pack the tent', `Pack the big tent ^${id}`));
  await emitVaultChanged(page, ['Plans.md']);
  await expect(pane(page, 1).getByLabel('Embedded block', { exact: true })).toHaveText(
    'Pack the big tent',
  );

  // Its note's name opens the note at the block.
  await pane(page, 1).getByRole('link', { name: 'Plans' }).click();
  await expect(pane(page, 1).getByRole('article', { name: 'Plans' })).toBeVisible();
  const revealed = pane(page, 1).locator('.editor .is-revealed');
  await expect(revealed).toHaveCount(1);
  await expect(revealed).toContainText('Pack the big tent');

  // Renamed, with the links to it updated: the embed follows, its block id and all.
  await openNote(page, 'Journal', pane(page, 1));
  await pages(page).getByRole('treeitem', { name: 'Plans', exact: true }).hover();
  await pages(page).getByRole('button', { name: 'Options for Plans', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Rename/ }).click();
  const name = pages(page).getByRole('textbox', { name: 'Name for Plans' });
  await name.fill('Summer');
  await name.press('Enter');
  await page.getByRole('button', { name: /^Update 1 link/ }).click();
  await expectFile(vault, 'Journal.md').toBe(`# Journal\n\nToday.\n\n![[Summer#^${id}]]\n`);
  const followed = pane(page, 1).getByRole('group', { name: 'Embedded block from Summer' });
  await expect(followed.getByLabel('Embedded block', { exact: true })).toHaveText(
    'Pack the big tent',
  );
});

test('a missing block, a missing note and an archived note each say so', async ({ page }) => {
  const vault = await createVault();
  await vault.write('Plans.md', '# Plans\n\nKept. ^k1\n');
  await vault.mkdir('Archive');
  await vault.write('Archive/Old.md', '# Old\n\nOld words. ^o1\n');
  await vault.write(
    'Journal.md',
    '# Journal\n\n![[Plans#^gone]]\n\n![[Nowhere#^k1]]\n\n![[Old#^o1]]\n\n![[Plans#^k1]]\n',
  );
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await openNote(page, 'Journal');

  const embeds = page.locator('.editor [data-block-embed]');
  await expect(embeds).toHaveCount(4);
  await expect(embeds.nth(0)).toContainText('“Plans” has no block ^gone');
  await expect(embeds.nth(0)).toHaveClass(/block-embed--broken/);
  await expect(embeds.nth(1)).toContainText('No note is called “Nowhere”');
  await expect(embeds.nth(2)).toContainText('Archived');
  await expect(embeds.nth(2).getByLabel('Embedded block', { exact: true })).toHaveText(
    'Old words.',
  );
  await expect(embeds.nth(3)).not.toHaveClass(/block-embed--broken/);
  await expect(embeds.nth(3).getByLabel('Embedded block', { exact: true })).toHaveText('Kept.');
});

test('a note that shows a block showing it back stops after one level', async ({ page }) => {
  const vault = await createVault();
  await vault.write('A.md', 'In A. ^a1\n\n![[B#Part]]\n');
  await vault.write('B.md', '# Part\n\n![[A#^a1]]\n');
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await openNote(page, 'A');
  const shown = page.getByRole('group', { name: 'Embedded block from B' });
  await expect(shown).toBeVisible();
  // B's section holds a shown block of A: drawn as its link, not opened again.
  await expect(shown.locator('[data-block-embed]')).toHaveCount(0);
  await expect(shown.getByRole('link', { name: /A#\^a1/ })).toBeVisible();
});

test('a plain [[Note#^id]] link opens its note at the block', async ({ page }) => {
  const vault = await createVault();
  await vault.write('Plans.md', `# Plans\n\n${'Filler.\n\n'.repeat(40)}The one. ^t1\n`);
  await vault.write('Journal.md', '# Journal\n\nSee [[Plans#^t1]].\n');
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await openNote(page, 'Journal');
  await page.locator('.editor [data-wikilink="Plans"]').click();
  await expect(page.getByRole('article', { name: 'Plans' })).toBeVisible();
  const revealed = page.locator('.editor .is-revealed');
  await expect(revealed).toHaveText('The one.');
  await expect(revealed).toBeInViewport();
});

test('a block with an id shows it, faintly, in both themes (A26-01)', async ({ page }) => {
  const vault = await createVault();
  await vault.write(
    'Plans.md',
    '# Plans\n\n## Part ^h1\n\nKept. ^k1\n\n- Pack the tent ^t1\n- Book\n',
  );
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await openNote(page, 'Plans');
  const marked = page.locator('.editor [data-block-anchor]');
  await expect(marked).toHaveCount(3);
  // The id is drawn after the block's words, never as its text.
  await expect(marked.nth(1)).toHaveText('Kept.');
  /** The id drawn after a block's words, how it is drawn, and the ink of the words. */
  const marker = (at: number) =>
    marked.nth(at).evaluate((element) => {
      const words = element.matches('li') ? element.querySelector(':scope > p') : element;
      const style = getComputedStyle(words ?? element, '::after');
      return { content: style.content, color: style.color, ink: getComputedStyle(element).color };
    });
  const colours: string[] = [];
  for (const scheme of ['light', 'dark'] as const) {
    await page.evaluate((name) => (document.documentElement.dataset['theme'] = name), scheme);
    const shown = await Promise.all([0, 1, 2].map(marker));
    expect(shown.map(({ content }) => content)).toEqual(['"^h1"', '"^k1"', '"^t1"']);
    // Faint: a quieter ink than the words it follows.
    for (const { color, ink } of shown) expect(color).not.toBe(ink);
    colours.push(shown[1]!.color);
  }
  // Each theme's own quiet ink.
  expect(colours[0]).not.toBe(colours[1]);
});

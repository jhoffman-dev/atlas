import { expect, test, type Page } from './fixtures.ts';
import { createVault, installHost, sidebarSection } from './host.ts';

/**
 * UI v2 slice 2 (#292, PR #328 review): every `.btn` is 28px tall, and a
 * surface that gives its button padding of its own must not fight that —
 * `.empty__action` on the welcome screen and `.archive__unarchive` in the
 * Archive both used to. The box stays 28px whatever the padding, so the
 * padding is measured directly: a `.btn` centres its words in its height and
 * leaves no vertical padding to anything.
 */
const BUTTON_HEIGHT = 28;

/** The button's height, and its vertical padding, which must be none. */
async function measure(
  page: Page,
  name: string,
): Promise<{ height: number; verticalPadding: number }> {
  const button = page.getByRole('button', { name, exact: true });
  await expect(button).toBeVisible();
  return button.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      height: element.getBoundingClientRect().height,
      verticalPadding: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
    };
  });
}

const PLAN = [
  '---',
  'type: task',
  'archived: 2026-09-01',
  'archivedFrom: Plan.md',
  '---',
  '',
  'Bake.',
  '',
];

test('the welcome screen’s buttons are drawn at the button height', async ({ page }) => {
  const vault = await createVault();
  await installHost(page, vault);
  await page.goto('/');
  for (const name of ['Choose folder…', 'Open a vault from GitHub…']) {
    const { height, verticalPadding } = await measure(page, name);
    expect(height, name).toBeCloseTo(BUTTON_HEIGHT, 0);
    expect(verticalPadding, `${name} has no vertical padding`).toBe(0);
  }
});

test('the Archive’s Unarchive button is drawn at the button height', async ({ page }) => {
  const vault = await createVault();
  await vault.mkdir('Archive');
  await vault.write('Archive/Plan.md', PLAN.join('\n'));
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();

  await sidebarSection(page, 'userSpace')
    .getByRole('treeitem', { name: 'Archive', exact: true })
    .click();
  const archive = page.getByRole('article', { name: 'Archive' });
  await expect(archive.getByRole('button', { name: 'Unarchive Plan' })).toBeVisible();
  const { height, verticalPadding } = await measure(page, 'Unarchive Plan');
  expect(height).toBeCloseTo(BUTTON_HEIGHT, 0);
  expect(verticalPadding).toBe(0);
});

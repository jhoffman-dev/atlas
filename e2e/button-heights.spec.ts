import { expect, test, type Page } from '@playwright/test';
import { createVault, installHost, sidebarSection } from './host.ts';

/**
 * UI v2 slice 2 (#292, PR #328 review): every `.btn` is 28px tall, and a
 * surface that gives its button padding of its own must not fight that —
 * `.empty__action` on the welcome screen and `.archive__unarchive` in the
 * Archive both used to. The box stays 28px whatever the padding, so what the
 * padding costs is the room the words have: the content box must hold a line.
 */
const BUTTON_HEIGHT = 28;

/** The button's height, and whether its content box is at least a line of its text tall. */
async function measure(
  page: Page,
  name: string,
): Promise<{ height: number; roomForWords: boolean }> {
  const button = page.getByRole('button', { name, exact: true });
  await expect(button).toBeVisible();
  return button.evaluate((element) => {
    const style = getComputedStyle(element);
    const room =
      element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    return {
      height: element.getBoundingClientRect().height,
      roomForWords: room >= parseFloat(style.fontSize),
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
    const { height, roomForWords } = await measure(page, name);
    expect(height, name).toBeCloseTo(BUTTON_HEIGHT, 0);
    expect(roomForWords, `${name} has room for its words`).toBe(true);
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
  const { height, roomForWords } = await measure(page, 'Unarchive Plan');
  expect(height).toBeCloseTo(BUTTON_HEIGHT, 0);
  expect(roomForWords).toBe(true);
});

// The delayed spinner (#320): a note whose read is slow shows a ring — but
// only once 150 ms have passed, so a fast read never flashes one. The wait is
// the stylesheet's own clock, stepped here by hand, never slept on.
import { expect, test } from './fixtures.ts';
import { createVault, installHost, sidebarSection } from './host.ts';

const NOTE = 'Larkspur Payroll.md';

test('a slow read shows nothing at 149 ms, the spinner at 150, and the note once it lands', async ({
  page,
}) => {
  const vault = await createVault();
  await vault.write(NOTE, '# Larkspur Payroll\n\nMara Quill runs the October close.\n');
  await vault.write('Other.md', '# Other\n');
  const host = await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  // Only the pane's own read of the note is held: the index has read it already.
  const release = host.holdReads(NOTE, { alone: true });

  await sidebarSection(page, 'userSpace')
    .getByRole('treeitem', { name: 'Larkspur Payroll', exact: true })
    .click();
  const spinner = page.getByRole('status', { name: 'Reading the note…' });
  await expect(spinner).toBeAttached();

  const ring = spinner.locator('.spinner__ring');
  const opacityAt = (ms: number) =>
    ring.evaluate((element, at) => {
      const shown = element
        .getAnimations()
        .find((animation) => (animation as CSSAnimation).animationName === 'spinner-shown');
      if (shown === undefined) throw new Error('the ring has no delayed showing');
      shown.pause();
      shown.currentTime = at;
      return getComputedStyle(element).opacity;
    }, ms);
  expect(await opacityAt(149)).toBe('0');
  expect(await opacityAt(150)).toBe('1');

  release();
  await expect(page.getByText('Mara Quill runs the October close.')).toBeVisible();
  await expect(spinner).toHaveCount(0);
});

import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { createVault, emitVaultChanged, expectFile, installHost, type FakeVault } from './host.ts';

/**
 * Issue #12 (P28-06): a meeting that arrives with a misheard product name and
 * a misheard colleague's name is let in with both put right, the change list
 * in its frontmatter; its page shows the band saying what changed, and Undo
 * corrections puts back the original words, byte for byte.
 */

const shipped = (path: string) =>
  readFileSync(new URL(`../vault/${path}`, import.meta.url), 'utf8');
const VALID = readFileSync(
  new URL(
    '../packages/domain/src/meetings/fixtures/valid/gemini-platform-sync.md',
    import.meta.url,
  ),
  'utf8',
);

const MEETING = 'Inbox/Meetings/2026-09-29 Platform weekly sync.md';
/** The fixture as Gemini might mishear it: a product in the first turn, a colleague in the third. */
const MISHEARD = VALID.replace('start with the cache?', 'start with Lark Spur Pay?').replace(
  '**Mara Quill** [~00:09:44]',
  '**Mara Quil** [~00:09:44]',
);
const BODY = (text: string) => text.slice(text.indexOf('\n---\n', 4) + 5);

async function openVault(page: Page): Promise<FakeVault> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const vault = await createVault();
  for (const folder of ['.atlas/types', '.atlas/views', 'Inbox/Meetings', 'Terms', 'People']) {
    await vault.mkdir(folder);
  }
  for (const type of ['task', 'meeting', 'person', 'company', 'project', 'term']) {
    await vault.write(`.atlas/types/${type}.md`, shipped(`.atlas/types/${type}.md`));
  }
  await vault.write('.atlas/views/Inbox.md', shipped('.atlas/views/Inbox.md'));
  await vault.write(
    'Terms/Larkspur Pay.md',
    '---\ntype: term\nkind: product\nvariants:\n  - Lark Spur Pay\n---\n',
  );
  await vault.write(
    'Terms/Mara Quill.md',
    '---\ntype: term\nkind: person\nvariants:\n  - Mara Quil\n---\n',
  );
  // An alias links the person; it is never used to correct text.
  await vault.write('People/Mara Quill.md', '---\ntype: person\naliases:\n  - Mara Quil\n---\n');

  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

test('a misheard meeting arrives corrected, shows what changed, and Undo corrections puts the words back', async ({
  page,
}) => {
  const vault = await openVault(page);

  await vault.write(MEETING, MISHEARD);
  await emitVaultChanged(page, [MEETING]);
  await expectFile(vault, MEETING).toContain('start with Larkspur Pay?');
  const corrected = await vault.read(MEETING);
  expect(corrected).toContain('**Mara Quill** [~00:09:44]');
  expect(corrected).toMatch(
    /^atlas_corrections:\n {2}- from: Lark Spur Pay\n {4}to: Larkspur Pay/m,
  );

  await page
    .getByRole('list', { name: 'Go to' })
    .getByRole('button', { name: /^Inbox/ })
    .click();
  await page.getByRole('main').getByText('Platform weekly sync', { exact: true }).click();
  const band = page.getByRole('complementary', { name: 'Corrections' });
  await expect(band).toBeVisible();
  await expect(band.getByRole('listitem')).toHaveText([
    'Lark Spur Pay → Larkspur Pay',
    'Mara Quil → Mara Quill',
  ]);
  await expect(
    page.getByLabel('Note', { exact: true }).getByText(/start with Larkspur Pay\?/),
  ).toBeVisible();

  await band.getByRole('button', { name: 'Undo corrections' }).click();
  await expect.poll(async () => BODY(await vault.read(MEETING))).toBe(BODY(MISHEARD));
  await expect(band).toBeHidden();
  await expect(
    page.getByLabel('Note', { exact: true }).getByText(/start with Lark Spur Pay\?/),
  ).toBeVisible();
  expect(await vault.read(MEETING)).toMatch(/^atlas_corrections: undone$/m);
});

test('Undo corrections is refused, and the meeting left as it is, once its words were edited', async ({
  page,
}) => {
  const vault = await openVault(page);
  await vault.write(MEETING, MISHEARD);
  await emitVaultChanged(page, [MEETING]);
  await expectFile(vault, MEETING).toContain('start with Larkspur Pay?');

  await page
    .getByRole('list', { name: 'Go to' })
    .getByRole('button', { name: /^Inbox/ })
    .click();
  await page.getByRole('main').getByText('Platform weekly sync', { exact: true }).click();
  const band = page.getByRole('complementary', { name: 'Corrections' });
  await expect(band).toBeVisible();

  // Edited on another Mac and pulled: the body is no longer what the correction wrote.
  const edited = (await vault.read(MEETING)).replace('Friday works.', 'Friday works for me.');
  await vault.write(MEETING, edited);
  await emitVaultChanged(page, [MEETING]);

  await band.getByRole('button', { name: 'Undo corrections' }).click();
  await expect(band.getByRole('status')).toHaveText(
    'The meeting changed since its words were corrected, so they were left as they are.',
  );
  expect(await vault.read(MEETING)).toBe(edited);

  // The refusal cannot pass, so Undo is off and the band can be dismissed.
  await expect(band.getByRole('button', { name: 'Undo corrections' })).toBeDisabled();
  await band.getByRole('button', { name: 'Dismiss' }).click();
  await expect(band).toBeHidden();
});

import { expect, test, type Page } from '@playwright/test';
import {
  createVault,
  expectFile,
  expectSaved,
  installHost,
  sidebarSection,
  type FakeVault,
  saveNow,
  splitWindow,
  closePane,
} from './host.ts';
import { dragCardTo } from './drag.ts';

/**
 * R13-05: a write to a note that is open in a pane, in both directions.
 *
 * Phase 13 put the same note in two panes and gave one pane a way to write what
 * the other is holding. Nothing exercised it: `watcher.spec.ts` looks like it
 * does and writes a different file. Both directions matter — the write that
 * lands and has to reach the other pane, and the write that is refused and must
 * not take anyone's typing with it.
 */

const NOTE = '# Note\n\nOriginal paragraph.\n';
const OTHER = '# Other\n\nSomething else.\n';

async function openVault(page: Page): Promise<FakeVault> {
  const vault = await createVault();
  await vault.write('note.md', NOTE);
  await vault.write('other.md', OTHER);

  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

const pane = (page: Page, which: 1 | 2) => page.getByRole('region', { name: `Pane ${which}` });

/** Opens note.md and splits, so both panes hold the same note. */
async function splitOnNote(page: Page): Promise<void> {
  await sidebarSection(page, 'userSpace')
    .getByRole('treeitem', { name: 'note', exact: true })
    .click();
  await expect(pane(page, 1).getByRole('article', { name: 'note' })).toBeVisible();
  await splitWindow(page);
  await expect(pane(page, 2).getByRole('article', { name: 'note' })).toBeVisible();
}

/** Types at the end of a pane's paragraph, the way anyone would. */
async function typeInto(page: Page, which: 1 | 2, existing: string, addition: string) {
  await pane(page, which).getByText(existing).click();
  await page.keyboard.press('End');
  await page.keyboard.type(addition);
}

test('an edit saved in one pane reaches the file and the other pane showing it', async ({
  page,
}) => {
  const vault = await openVault(page);
  await splitOnNote(page);

  await typeInto(page, 1, 'Original paragraph.', ' Edited in pane 1.');
  await saveNow(page, pane(page, 1));

  await expectFile(vault, 'note.md').toContain('Edited in pane 1.');
  // The second pane held the note before the write and has nothing unsaved, so
  // it catches up rather than sitting on what the file used to say.
  await expect(pane(page, 2).getByText('Original paragraph. Edited in pane 1.')).toBeVisible();
  await expectSaved(pane(page, 2));
});

/** The file, moved on underneath whatever has it open. */
const STARRED = '---\nfavorite: true\n---\n\n# Note\n\nOriginal paragraph.\n';

test('a refused save can be written over, keeping what the other writer put in the file', async ({
  page,
}) => {
  const vault = await openVault(page);
  await splitOnNote(page);
  await vault.write('note.md', STARRED);
  await typeInto(page, 2, 'Original paragraph.', ' Typed in pane 2.');
  await expect(pane(page, 2).getByRole('alert')).toContainText('changed on disk');

  await pane(page, 2).getByRole('button', { name: 'Overwrite the file' }).click();

  await expectFile(vault, 'note.md').toContain('Typed in pane 2.');
  // The file is read again on the way past, so the star the other writer added
  // is still there: overwriting is about this pane's text, not about undoing
  // everything that happened while it was refused.
  expect(await vault.read('note.md')).toContain('favorite: true');
  await expectSaved(pane(page, 2));
});

test('a refused save can be given up, leaving the file as it is', async ({ page }) => {
  const vault = await openVault(page);
  await splitOnNote(page);
  await vault.write('note.md', '# Note\n\nWritten by something else.\n');
  await typeInto(page, 2, 'Original paragraph.', ' Typed in pane 2.');
  await expect(pane(page, 2).getByRole('alert')).toContainText('changed on disk');

  await pane(page, 2).getByRole('button', { name: 'Discard my changes' }).click();

  await expect(pane(page, 2).getByText('Written by something else.')).toBeVisible();
  await expect(pane(page, 2).getByText('Typed in pane 2.')).toHaveCount(0);
  await expectSaved(pane(page, 2));
  expect(await vault.read('note.md')).toBe('# Note\n\nWritten by something else.\n');
});

test('closing a pane whose save was refused keeps the work rather than dropping it', async ({
  page,
}) => {
  const vault = await openVault(page);
  // The panes hold different notes, so the note can be opened again afterwards.
  await sidebarSection(page, 'userSpace')
    .getByRole('treeitem', { name: 'other', exact: true })
    .click();
  await splitWindow(page);
  await sidebarSection(page, 'userSpace')
    .getByRole('treeitem', { name: 'note', exact: true })
    .click();
  await expect(pane(page, 2).getByRole('article', { name: 'note' })).toBeVisible();

  await vault.write('note.md', STARRED);
  await typeInto(page, 2, 'Original paragraph.', ' Typed in pane 2.');
  await expect(pane(page, 2).getByRole('alert')).toContainText('changed on disk');

  await closePane(page, 2);

  // The save on the way out is refused too. It used to be swallowed by an empty
  // catch, and the typing went with the pane.
  await expect(page.getByRole('alert')).toContainText('could not be saved');
  await sidebarSection(page, 'userSpace')
    .getByRole('treeitem', { name: 'note', exact: true })
    .click();
  await expect(pane(page, 1).getByText('Typed in pane 2.')).toBeVisible();
  await expect(pane(page, 1).getByText('Unsaved')).toBeVisible();
});

/**
 * R13-03: the board, the table, the calendar and the timeline all write notes
 * that a pane may be holding. Only the favourite star went through the pane.
 */

const TASK_TYPE = [
  '---',
  'name: task',
  'properties:',
  '  status:',
  '    kind: select',
  '    options: [backlog, doing, done]',
  '---',
  '',
].join('\n');

const BOARD = [
  '---',
  'atlas: view',
  'type: task',
  'layout: board',
  'groupBy: status',
  'columns: [status]',
  'limit: 50',
  '---',
  '',
  '# Board',
  '',
].join('\n');

const TASK = [
  '---',
  'type: task',
  'status: backlog',
  '---',
  '',
  '# First',
  '',
  'The work.',
  '',
].join('\n');

test('a card dragged on a board does not strand the note open in the other pane', async ({
  page,
}) => {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('.atlas/views');
  await vault.write('.atlas/types/task.md', TASK_TYPE);
  await vault.write('.atlas/views/Board.md', BOARD);
  await vault.write('first.md', TASK);
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();

  await sidebarSection(page, 'views').getByRole('button', { name: 'Board', exact: true }).click();
  await splitWindow(page);
  await sidebarSection(page, 'userSpace')
    .getByRole('treeitem', { name: 'first', exact: true })
    .click();
  await expect(pane(page, 2).getByRole('article', { name: 'first' })).toBeVisible();

  await dragCardTo(page, 'first.md', 'done');

  await expectFile(vault, 'first.md').toContain('status: done');
  // The pane holding the note is told, rather than left showing what the file
  // used to say until something else happens to reload it.
  await expect(
    pane(page, 2).getByRole('region', { name: 'Properties' }).getByLabel('status'),
  ).toHaveValue('done');

  // And its own save still works: an everyday board gesture must not leave the
  // note unsavable in the pane beside it.
  await typeInto(page, 2, 'The work.', ' Typed after the drag.');
  await saveNow(page, pane(page, 2));

  await expectFile(vault, 'first.md').toContain('Typed after the drag.');
  await expectSaved(pane(page, 2));
  expect(await vault.read('first.md')).toContain('status: done');
});

test('a save refused because the note moved on keeps what was typed', async ({ page }) => {
  const vault = await openVault(page);
  await splitOnNote(page);

  // Something writes the file without telling the app — another app, a sync
  // client, or the other pane before this one is told. Written from outside
  // rather than from pane 1 so the refusal does not depend on beating an
  // autosave to it: a stale modification time is refused however it got stale.
  await vault.write('note.md', '---\nfavorite: true\n---\n\n# Note\n\nOriginal paragraph.\n');

  await typeInto(page, 2, 'Original paragraph.', ' Typed in pane 2.');

  // The autosave is refused, and says so rather than claiming to have saved.
  await expect(pane(page, 2).getByRole('alert')).toContainText('changed on disk');
  await expect(pane(page, 2).getByText('Unsaved')).toBeVisible();
  // Nothing typed has gone from the screen, and nothing has gone from the file.
  await expect(pane(page, 2).getByText('Typed in pane 2.')).toBeVisible();
  const onDisk = await vault.read('note.md');
  expect(onDisk).toContain('favorite: true');
  expect(onDisk).not.toContain('Typed in pane 2.');
});

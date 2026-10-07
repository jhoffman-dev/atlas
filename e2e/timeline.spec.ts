import { expect, test, type Page } from '@playwright/test';
import { createVault, expectFile, installHost, sidebarSection } from './host.ts';
import { dragWithKeyboard, dragWithPointer } from './drag.ts';

const TASK_TYPE = [
  '---',
  'name: task',
  'properties:',
  '  id: text',
  '  scheduled: date',
  '  due: date',
  '  blocked_by:',
  '    kind: text',
  '    many: true',
  '---',
  '',
].join('\n');

const ROADMAP = [
  '---',
  'atlas: view',
  'type: task',
  'layout: timeline',
  'startKey: scheduled',
  'endKey: due',
  'columns: [scheduled, due, id, blocked_by]',
  'limit: 100',
  '---',
  '',
  '# Roadmap',
  '',
].join('\n');

const task = (id: string, lines: readonly string[]): string =>
  ['---', 'type: task', `id: ${id}`, ...lines, '---', '', `Work on ${id}.`, ''].join('\n');

async function openRoadmap(page: Page) {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('.atlas/views');
  await vault.write('.atlas/types/task.md', TASK_TYPE);
  await vault.write('.atlas/views/Roadmap.md', ROADMAP);
  await vault.write('design.md', task('A', ['scheduled: 2026-09-01', 'due: 2026-09-03']));
  await vault.write(
    'build.md',
    task('B', ['scheduled: 2026-09-04', 'due: 2026-09-08', 'blocked_by: [A]']),
  );
  await vault.write('aside.md', task('C', ['scheduled: 2026-09-01', 'due: 2026-09-02']));
  await vault.write('someday.md', task('D', []));

  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();

  await sidebarSection(page, 'views').getByRole('button', { name: 'Roadmap', exact: true }).click();
  await expect(page.getByLabel('Timeline')).toBeVisible();
  return vault;
}

test('dated notes appear as bars across the range', async ({ page }) => {
  await openRoadmap(page);

  await expect(page.locator('.timeline__bar')).toHaveCount(3);
  await expect(page.getByText('Tue, Sep 1, 2026 → Tue, Sep 8, 2026')).toBeVisible();
});

test('a note with no dates is counted rather than hidden', async ({ page }) => {
  await openRoadmap(page);
  await expect(page.getByText('1 with no scheduled')).toBeVisible();
});

test('the chain that decides the end date is picked out', async ({ page }) => {
  await openRoadmap(page);

  await expect(page.locator('[data-path="design.md"]')).toHaveClass(/timeline__bar--critical/);
  await expect(page.locator('[data-path="build.md"]')).toHaveClass(/timeline__bar--critical/);
  await expect(page.locator('[data-path="aside.md"]')).not.toHaveClass(/timeline__bar--critical/);
});

test('clicking a bar opens the work it stands for', async ({ page }) => {
  await openRoadmap(page);

  await page.locator('[data-path="build.md"]').click();
  await expect(page.locator('.tiptap')).toContainText('Work on B.');
});

test('dragging a bar moves both of its dates in the file', async ({ page }) => {
  const vault = await openRoadmap(page);

  // Grabbed just inside its first day and carried 78px: one day is 26px wide,
  // so that is three days later.
  const bar = await page.locator('[data-path="design.md"]').boundingBox();
  if (bar === null) throw new Error('the timeline has no bar to drag');
  const grabbedAt = { x: bar.x + 5, y: bar.y + bar.height / 2 };
  await dragWithPointer(page, {
    from: grabbedAt,
    to: { x: grabbedAt.x + 78, y: grabbedAt.y },
    overText: 'would move 3 days later',
  });

  await expectFile(vault, 'design.md').toContain('scheduled: 2026-09-04');
  expect(await vault.read('design.md')).toContain('due: 2026-09-06');
});

test('a bar can be moved a day at a time with the keyboard alone', async ({ page }) => {
  const vault = await openRoadmap(page);
  const build = page.locator('[data-path="build.md"]');

  // Two presses, two days: both ends move, so a bar that moved once, not at
  // all, or by only one of its dates leaves something else in the file.
  await dragWithKeyboard(page, build, ['ArrowRight', 'ArrowRight']);

  await expectFile(vault, 'build.md').toContain('scheduled: 2026-09-06');
  expect(await vault.read('build.md')).toContain('due: 2026-09-10');
  await expect(build).toBeFocused();
});

test('escape puts a keyboard-held bar down without writing anything', async ({ page }) => {
  const vault = await openRoadmap(page);

  await dragWithKeyboard(page, page.locator('[data-path="build.md"]'), ['ArrowRight'], {
    finish: 'Escape',
  });
  // A write known to happen, to a different note, made after the cancel: once
  // it has landed, one the cancel made would have landed too.
  await dragWithKeyboard(page, page.locator('[data-path="design.md"]'), ['ArrowRight']);
  await expectFile(vault, 'design.md').toContain('scheduled: 2026-09-02');

  expect(await vault.read('build.md')).toContain('scheduled: 2026-09-04');
});

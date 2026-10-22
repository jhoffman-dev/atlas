import { expect, test, type Locator, type Page } from './fixtures.ts';
import {
  createVault,
  expectFile,
  installHost,
  saveNow,
  sidebarSection,
  splitWindow,
  type FakeVault,
} from './host.ts';
import { literatureNote } from './research-notes.ts';
import { researchVault } from '../tools/perf/research-vault.ts';
import { writeVault } from '../tools/perf/session.ts';

/**
 * Tests for the research area (#507): a highlight dragged where an embed has
 * no place (a code block, a table), a drag let go, and All highlights at
 * 20,000 highlights as its filters change.
 */

const ART = literatureNote({
  title: 'The Art of War',
  author: 'Sun Tzu',
  kind: 'pdf',
  highlights: [
    { id: 'k3x9q2', quote: 'All warfare is based on deception.', color: 'green', at: 3 },
  ],
});

const JOURNAL = [
  '# Journal',
  '',
  '```',
  'const ledger = 1;',
  '```',
  '',
  '| Name | Count |',
  '| --- | --- |',
  '| Larkspur | 2 |',
  '',
  'Today.',
  '',
].join('\n');

async function openVault(page: Page): Promise<FakeVault> {
  const vault = await createVault();
  await vault.mkdir('Library');
  await vault.write('Library/The Art of War.md', ART);
  await vault.write('Journal.md', JOURNAL);
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

const highlightRows = (page: Page) =>
  page.getByRole('list', { name: 'Highlights' }).getByRole('listitem');

async function journalBesideHighlights(page: Page): Promise<Locator> {
  await sidebarSection(page, 'userSpace')
    .getByRole('treeitem', { name: 'Journal', exact: true })
    .click();
  const journal = page.getByRole('article', { name: 'Journal' });
  await expect(journal).toBeVisible();
  await splitWindow(page);
  await page
    .getByRole('list', { name: 'Go to' })
    .getByRole('button', { name: 'All highlights', exact: true })
    .click();
  await expect(highlightRows(page)).toHaveCount(1);
  return journal;
}

/** Drags the one highlight row onto the middle of `target`, dropping it unless told to let go. */
async function dragRowOnto(page: Page, target: Locator, { drop }: { drop: boolean }) {
  const box = await target.boundingBox();
  if (box === null) throw new Error('the drop target is not on screen');
  await highlightRows(page)
    .first()
    .evaluate(
      (source, { x, y, drop: dropIt }) => {
        const transfer = new DataTransfer();
        source.dispatchEvent(
          new DragEvent('dragstart', { dataTransfer: transfer, bubbles: true, cancelable: true }),
        );
        const editor = document.querySelector<HTMLElement>(
          'article[aria-label="Journal"] .ProseMirror',
        );
        if (editor === null) throw new Error('no editor for Journal');
        const init = {
          dataTransfer: transfer,
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
        };
        editor.dispatchEvent(new DragEvent('dragover', init));
        if (dropIt) editor.dispatchEvent(new DragEvent('drop', init));
        else {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          editor.dispatchEvent(new DragEvent('dragleave', init));
        }
        source.dispatchEvent(new DragEvent('dragend', { dataTransfer: transfer, bubbles: true }));
      },
      { x: box.x + box.width / 2, y: box.y + box.height / 2, drop },
    );
}

/** The Journal's code block and table are as written, and no HTML of the drag reached the file. */
function expectJournalIntact(saved: string) {
  expect(saved).toContain('```\nconst ledger = 1;');
  expect(saved).toMatch(/\| *Larkspur *\| *2 *\|/);
  expect(saved).not.toContain('data-block-embed');
  expect(saved).not.toContain('<div');
}

test('a highlight dropped on a code block leaves the code as written and no HTML in the note', async ({
  page,
}) => {
  const vault = await openVault(page);
  const journal = await journalBesideHighlights(page);
  await dragRowOnto(page, journal.locator('pre').first(), { drop: true });
  await saveNow(page, page.getByRole('region', { name: 'Pane 1' }));
  // The drop did something (else this test proves nothing): wait for it to be saved.
  await expectFile(vault, 'Journal.md').not.toBe(JOURNAL);
  const saved = await vault.read('Journal.md');
  expectJournalIntact(saved);
  // An embed is a block: it is never written into the code as text either.
  expect(saved).not.toMatch(/```[^`]*!\[\[The Art of War#\^k3x9q2\]\][^`]*```/);
});

test('a highlight dropped on a table cell leaves the table a table', async ({ page }) => {
  const vault = await openVault(page);
  const journal = await journalBesideHighlights(page);
  await dragRowOnto(page, journal.getByRole('cell', { name: 'Larkspur' }), { drop: true });
  await saveNow(page, page.getByRole('region', { name: 'Pane 1' }));
  // The drop did something (else this test proves nothing): wait for it to be saved.
  await expectFile(vault, 'Journal.md').not.toBe(JOURNAL);
  const saved = await vault.read('Journal.md');
  expectJournalIntact(saved);
  for (const line of saved.split('\n').filter((each) => each.startsWith('|'))) {
    expect(line.trimEnd().endsWith('|'), `table row ${line}`).toBe(true);
  }
});

test('a drag let go with Escape changes no note', async ({ page }) => {
  const vault = await openVault(page);
  const journal = await journalBesideHighlights(page);
  await dragRowOnto(page, journal.getByText('Today.'), { drop: false });
  await expect(journal.getByRole('group', { name: /Embedded block/ })).toHaveCount(0);
  await expect.poll(() => vault.read('Journal.md')).toBe(JOURNAL);
  await expect.poll(() => vault.read('Library/The Art of War.md')).toBe(ART);
});

test.describe('All highlights at 20,000', () => {
  test.describe.configure({ timeout: 300_000 });

  test('a filter change keeps at most 80 rows drawn, and is measured', async ({ page }) => {
    const vault = await writeVault(researchVault());
    await installHost(page, vault);
    await page.goto('/');
    await page.getByRole('button', { name: 'Choose folder…' }).click();
    await expect(page.getByText(/notes indexed/)).toBeVisible({ timeout: 240_000 });
    await page
      .getByRole('list', { name: 'Go to' })
      .getByRole('button', { name: 'All highlights', exact: true })
      .click();
    const count = page.locator('.page-bar__count');
    await expect(count).toHaveText('20,000 highlights', { timeout: 60_000 });
    const drawn = () => page.locator('ul[aria-label="Highlights"] > li[data-index]').count();
    expect(await drawn()).toBeGreaterThan(0);
    expect(await drawn()).toBeLessThanOrEqual(80);

    const timings: string[] = [];
    const timed = async (what: string, act: () => Promise<void>, shown: RegExp) => {
      const started = Date.now();
      await act();
      await expect(count).toHaveText(shown, { timeout: 30_000 });
      timings.push(`${what}: ${Date.now() - started} ms`);
      const rows = await drawn();
      expect(rows, `${what}: ${rows} rows drawn`).toBeLessThanOrEqual(80);
    };
    const chips = page.getByRole('group', { name: /colou?r/i });
    await timed(
      'Green on',
      () => chips.getByRole('button', { name: /^Green/ }).click(),
      /^[\d,]+ of 20,000 highlights$/,
    );
    await timed(
      'Blue on',
      () => chips.getByRole('button', { name: /^Blue/ }).click(),
      /^[\d,]+ of 20,000 highlights$/,
    );
    await timed(
      'Green and Blue off',
      async () => {
        await chips.getByRole('button', { name: /^Green/ }).click();
        await chips.getByRole('button', { name: /^Blue/ }).click();
      },
      /^20,000 highlights$/,
    );
    test.info().annotations.push({ type: 'timing', description: timings.join('; ') });
  });
});

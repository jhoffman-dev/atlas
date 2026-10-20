/**
 * Attack on PR #418 (slice 12): the type editor moved into the right sidebar.
 * Each test pins one invariant the move put at risk: Edit type on a type's
 * page asks for that type's editor, and the 340px editor is reachable in a
 * window with room for the 300px aside but not for it beside the sidebar.
 */
import { expect, test, type Page } from './fixtures.ts';
import { createVault, installHost, sidebarSection, splitWindow, type FakeVault } from './host.ts';

const PERSON_TYPE = [
  '---',
  'name: person',
  'label: Person',
  'properties:',
  '  role: text',
  '---',
  '',
].join('\n');

const SESSION_TYPE = [
  '---',
  'name: session',
  'label: Session',
  'properties:',
  '  date: date',
  '  stage:',
  '    kind: select',
  '    options: [draft, final]',
  '---',
  '',
].join('\n');

const BOOK_TYPE = [
  '---',
  'name: book',
  'label: Book',
  'properties:',
  '  author: text',
  '---',
  '',
].join('\n');

async function open(page: Page, files: Record<string, string>): Promise<FakeVault> {
  const vault = await createVault();
  await vault.mkdir('.atlas/types');
  await vault.mkdir('.atlas/views');
  await vault.mkdir('.atlas/templates');
  for (const [path, text] of Object.entries(files)) await vault.write(path, text);
  await installHost(page, vault);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();
  return vault;
}

const aside = (page: Page) => page.getByRole('complementary', { name: 'Right sidebar' });

async function editSession(page: Page) {
  await sidebarSection(page, 'types')
    .getByRole('button', { name: /^Session, / })
    .click();
  await page.getByRole('button', { name: 'Edit type' }).click();
  await expect(aside(page).getByRole('tab', { name: 'Type' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
}

test('Edit type pressed on a type page in the other pane edits that type, not hides the aside', async ({
  page,
}) => {
  await open(page, {
    '.atlas/types/person.md': PERSON_TYPE,
    '.atlas/types/session.md': SESSION_TYPE,
    '.atlas/types/book.md': BOOK_TYPE,
    'Standup.md': '# Standup\n',
  });
  const first = page.getByRole('region', { name: 'Pane 1' });
  const second = page.getByRole('region', { name: 'Pane 2' });
  await sidebarSection(page, 'userSpace').getByRole('treeitem', { name: 'Standup' }).click();
  await expect(first.getByRole('article', { name: 'Standup' })).toBeVisible();
  await splitWindow(page);
  await expect(second).toBeVisible();
  // Pane 1 on Session, its editor in the aside.
  await first.getByRole('article', { name: 'Standup' }).click();
  await editSession(page);
  await expect(first.getByRole('article', { name: 'Session' })).toBeVisible();
  // Pane 2, focused, goes to Book, and the aside follows it on to Book's editor.
  await second.getByRole('article', { name: 'Standup' }).click();
  await sidebarSection(page, 'types')
    .getByRole('button', { name: /^Book, / })
    .click();
  await expect(second.getByRole('article', { name: 'Book' })).toBeVisible();
  const name = aside(page).getByRole('textbox', { name: 'Name of this type' });
  await expect(name).toHaveValue('Book');

  // Session's page in pane 1 is not the one being edited, so its button is up…
  const editSessionButton = first.getByRole('button', { name: 'Edit type' });
  await expect(editSessionButton).toHaveAttribute('aria-pressed', 'false');
  // …and pressing it asks for Session's editor: the aside stays, on Session.
  await editSessionButton.click();
  await expect(aside(page)).toBeVisible();
  await expect(name).toHaveValue('Session');
  await expect(editSessionButton).toHaveAttribute('aria-pressed', 'true');
});

test('choosing the Type tab in a 1040px window does not fold the aside out from under the click', async ({
  page,
}) => {
  await open(page, {
    '.atlas/types/person.md': PERSON_TYPE,
    '.atlas/types/session.md': SESSION_TYPE,
  });
  // Room for the 300px aside beside the left sidebar (1020), not for the 340px editor (1060).
  await page.setViewportSize({ width: 1040, height: 800 });
  await sidebarSection(page, 'types')
    .getByRole('button', { name: /^Session, / })
    .click();
  await page.getByRole('button', { name: 'Right sidebar' }).click();
  await expect(aside(page)).toBeVisible();
  await aside(page).getByRole('tab', { name: 'Properties' }).click();
  await expect(aside(page).getByRole('tab', { name: 'Properties' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await aside(page).getByRole('tab', { name: 'Type' }).click();
  // The tab clicked is shown: the aside makes room, as Edit type does, rather than vanishing.
  await expect(aside(page)).toBeVisible();
  await expect(aside(page).getByRole('textbox', { name: 'Name of this type' })).toHaveValue(
    'Session',
  );
});

test('in a 1040px window, the Right sidebar button brings back an aside folded on the Type tab', async ({
  page,
}) => {
  await open(page, {
    '.atlas/types/person.md': PERSON_TYPE,
    '.atlas/types/session.md': SESSION_TYPE,
  });
  await page.setViewportSize({ width: 1040, height: 800 });
  // Edit type makes room for the 340px editor by hiding the left sidebar…
  await editSession(page);
  await expect(page.getByRole('button', { name: 'Show sidebar' })).toBeVisible();
  // …and bringing the sidebar back folds the editor, which is the #387 rule.
  await page.getByRole('button', { name: 'Show sidebar' }).click();
  await expect(aside(page)).toBeHidden();

  // Asked for again, the aside comes back, making room as Edit type did.
  await page.getByRole('button', { name: 'Right sidebar' }).click();
  await expect(aside(page)).toBeVisible();
});

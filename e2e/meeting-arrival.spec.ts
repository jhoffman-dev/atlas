import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createVault, emitVaultChanged, expectFile, installHost } from './host.ts';

/**
 * A meeting through all of the import's own steps at once (#92, P28-06,
 * P29-04): it lands with a misheard product, a speaker under a misheard name,
 * an attendee the vault knows and one it does not. It is linked, then
 * corrected and stamped in one write; the unknown attendee is one proposal;
 * and a rule set off when a meeting is created runs once, on the meeting as
 * it arrived — linked already, or its query would not have matched. Every
 * claim about a file reads the disk.
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
/** Tobias is not an attendee here, and speaks as "Tobias Fen"; Ada Venn attends and is no one's note. */
const ARRIVING = VALID.replace(
  '  - name: Tobias Fenn\n    email: tobias.fenn@example.com\n',
  '  - name: Ada Venn\n    email: ada.venn@example.com\n',
)
  .replace('start with the cache?', 'start with Lark Spur Pay?')
  .replaceAll('**Tobias Fenn** [', '**Tobias Fen** [');

const rule = (lines: readonly string[]) =>
  ['---', 'atlas: automation', 'enabled: true', ...lines, '---', ''].join('\n');
/** Runs only on a meeting that already links Mara: an arrival heard before the links would never match. */
const SEEN = rule([
  'name: Mark linked arrivals',
  'id: Mark linked arrivals',
  'when: a meeting is created',
  'which: FROM meeting WHERE people = [[Mara Quill]]',
  'do: set',
  'set:',
  '  kind: Seen',
]);
/** Would run if a write of the import's own were heard as an edit of a standup. */
const EDITED = rule([
  'name: Mark edited standups',
  'id: Mark edited standups',
  'when: a meeting is changed',
  'which: FROM meeting WHERE kind = Standup',
  'do: set',
  'set:',
  '  kind: Edited',
]);

test('a meeting arrives corrected, linked and stamped; its stranger is proposed once; a created rule runs once on it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const vault = await createVault();
  for (const folder of [
    '.atlas/types',
    '.atlas/views',
    '.atlas/automations',
    'Inbox/Meetings',
    'Terms',
    'People',
  ]) {
    await vault.mkdir(folder);
  }
  for (const type of ['task', 'meeting', 'person', 'company', 'project', 'proposal', 'term']) {
    await vault.write(`.atlas/types/${type}.md`, shipped(`.atlas/types/${type}.md`));
  }
  await vault.write('.atlas/views/Inbox.md', shipped('.atlas/views/Inbox.md'));
  await vault.write('.atlas/automations/Mark linked arrivals.md', SEEN);
  await vault.write('.atlas/automations/Mark edited standups.md', EDITED);
  await vault.write(
    'Terms/Larkspur Pay.md',
    '---\ntype: term\nkind: product\nvariants:\n  - Lark Spur Pay\n---\n',
  );
  await vault.write(
    'Terms/Tobias Fenn.md',
    '---\ntype: term\nkind: person\nvariants:\n  - Tobias Fen\n---\n',
  );
  await vault.write(
    'People/Mara Quill.md',
    '---\ntype: person\nemail: mara.quill@example.com\n---\n',
  );
  await vault.write('People/Tobias Fenn.md', '---\ntype: person\n---\n');
  await installHost(page, vault);
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText(/notes indexed/)).toBeVisible();

  await vault.write(MEETING, ARRIVING);
  await emitVaultChanged(page, [MEETING]);

  // The rule's own write is the last thing to happen to the meeting: wait for it.
  await expectFile(vault, MEETING).toContain('\nkind: Seen\n');
  const arrived = await vault.read(MEETING);
  expect(arrived).toContain('atlas_import_outcome: imported');
  // Corrected: the product, and the speaker's label in both of his turns.
  expect(arrived).toContain('start with Larkspur Pay?');
  expect(arrived).not.toContain('**Tobias Fen** [');
  expect(arrived.match(/\*\*Tobias Fenn\*\* \[/g)).toHaveLength(2);
  expect(arrived).toMatch(/^atlas_corrections:\n {2}- from: Lark Spur Pay\n {4}to: Larkspur Pay/m);
  // Linked: Mara by her address, Tobias by the name his label was corrected to.
  expect(arrived).toMatch(/\npeople:\n {2}- "\[\[Mara Quill\]\]"\n {2}- "\[\[Tobias Fenn\]\]"\n/);
  expect(arrived).not.toContain('Ada Venn]]');

  // Ada is proposed, once.
  const proposals = await readdir(join(vault.root, 'Inbox/Proposals'));
  expect(proposals).toHaveLength(1);
  await expectFile(vault, `Inbox/Proposals/${proposals[0]}`).toContain('ada.venn@example.com');

  // The created rule ran once; nothing the import wrote was heard as an edit.
  const log = '.atlas/automations/log/Mark linked arrivals.md';
  await expectFile(vault, log).toContain(`- triggered by \`"${MEETING}"\` at`);
  expect((await vault.read(log)).match(/· Ran when a note appeared or changed/g)).toHaveLength(1);
  await page.getByRole('button', { name: 'Automations', exact: true }).click();
  const list = page.getByRole('list', { name: 'All automations' });
  await expect(list.getByText(/Changed 1 note\./)).toHaveCount(1);
  expect(await vault.exists('.atlas/automations/log/Mark edited standups.md')).toBe(false);
  expect(await vault.read(MEETING)).toContain('\nkind: Seen\n');

  // Undo corrections still works on a meeting whose frontmatter linking wrote.
  await page
    .getByRole('list', { name: 'Go to' })
    .getByRole('button', { name: /^Inbox/ })
    .click();
  // The Inbox reads its GTD offer once it is open, and the offer lands above the
  // list: a click aimed at the meeting before it lands falls on the gap it leaves.
  await expect(page.getByRole('region', { name: 'Move tasks to GTD statuses' })).toBeVisible();
  await page.getByRole('main').getByText('Platform weekly sync', { exact: true }).click();
  const band = page.getByRole('complementary', { name: 'Corrections' });
  await band.getByRole('button', { name: 'Undo corrections' }).click();
  await expectFile(vault, MEETING).toMatch(/^atlas_corrections: undone$/m);
  const undone = await vault.read(MEETING);
  expect(undone).toContain('start with Lark Spur Pay?');
  expect(undone.match(/\*\*Tobias Fen\*\* \[/g)).toHaveLength(2);
  expect(undone).toMatch(/\npeople:\n {2}- "\[\[Mara Quill\]\]"\n {2}- "\[\[Tobias Fenn\]\]"\n/);
});

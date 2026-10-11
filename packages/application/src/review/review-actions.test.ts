import { splitFrontmatter } from '@atlas/domain';
import { describe, expect, it } from 'vitest';
import { setNoteProperties } from '../query/set-property.ts';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { memoryVault } from '../testing/fake-git.ts';
import { archiveTaskChange } from './review-actions.ts';

/** P30-07: the review's Archive, written as the done tick writes it. */
const PATH = 'Tasks/Water the beds.md';

async function archive(text: string): Promise<Readonly<Record<string, unknown>>> {
  const memory = memoryVault({ [PATH]: text });
  const markdown = fakeMarkdown();
  await setNoteProperties({
    fs: fakeVaultFs(memory.fs),
    markdown,
    path: PATH,
    values: archiveTaskChange(),
    today: '2026-10-08',
  });
  const written = memory.files.get(PATH) ?? '';
  return markdown.frontmatterProperties(splitFrontmatter(written).frontmatter ?? '');
}

describe('archiveTaskChange', () => {
  it('rolls a repeating task on to its next date, back at Next Action, rather than ending it', async () => {
    const properties = await archive(
      '---\ntype: task\nstatus: waiting\nwaiting_on: Mara Quill\ndue: 2026-09-28\nrecurrence: every week\n---\n\nBody.\n',
    );
    expect(properties).toMatchObject({
      status: 'next-action',
      due: '2026-10-05',
      lastCompleted: '2026-09-28',
    });
    expect(properties).not.toHaveProperty('completed');
  });

  it('finishes a task that does not repeat, dated today', async () => {
    const properties = await archive('---\ntype: task\nstatus: someday\n---\n\nBody.\n');
    expect(properties).toMatchObject({ status: 'archive', completed: '2026-10-08' });
  });
});

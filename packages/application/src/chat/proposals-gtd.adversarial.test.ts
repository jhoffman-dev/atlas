/**
 * Adversarial pass on P30-02 (ADR-0029): an edit the assistant proposes to a
 * task is a write like any other, so it is held to the task rules — Waiting
 * is waiting on someone, and Archive is dated.
 */
import { describe, expect, it } from 'vitest';
import { apiFixture } from '../testing/api-fixture.ts';
import { blockMarkdown } from '../testing/block-markdown.ts';
import { proposeEdit } from './proposals.ts';

const TASK = '---\ntype: task\nstatus: next-action\n---\nCall the printer.\n';

async function propose(properties: Record<string, unknown>) {
  const fixture = apiFixture({ files: { 'Call.md': TASK }, markdown: blockMarkdown() });
  return proposeEdit({
    fs: fixture.fs,
    markdown: blockMarkdown(),
    input: { path: 'Call.md', properties },
    id: 'p1',
  });
}

describe('proposeEdit on a GTD task', () => {
  it('never proposes a task Waiting with nobody to wait on', async () => {
    const made = await propose({ status: 'waiting' }).catch(() => null);
    expect(made?.contents ?? '').not.toContain('status: waiting');
  });

  it('dates a task it proposes to move to Archive', async () => {
    const made = await propose({ status: 'archive' });
    expect(made.contents).toContain('completed:');
  });
});

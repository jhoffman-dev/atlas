import { describe, expect, it } from 'vitest';
import type { MarkdownPort } from '../notes/ports.ts';
import {
  jsonLinesMarkdown,
  jsonLinesNote,
  proposalVault,
  vaultPath,
} from '../testing/proposal-vault.ts';
import { heldToTaskRules, readLinkNote } from './proposal-writes.ts';

/**
 * #376: a link proposal's note, when its block lists a key twice, is read as
 * the writer reads it — the strict read gives up on such a block — so its
 * relation is found and its change held to the task rules (ADR-0029).
 */
const TODAY = '2026-10-18';
const TASK = 'Tasks/Water the ferns.md';

/** jsonLinesMarkdown, but a block listing a key twice reads as nothing unless read for writing, as the YAML reader does. */
function duplicateAwareMarkdown(): MarkdownPort {
  const inner = jsonLinesMarkdown();
  return {
    ...inner,
    frontmatterProperties: (frontmatter, read) => {
      const keys = (frontmatter ?? '').split('\n').map((line) => /^([^:\s][^:]*):/.exec(line)?.[1]);
      const named = keys.filter((key) => key !== undefined);
      const listedTwice = new Set(named).size !== named.length;
      return listedTwice && read?.forWriting !== true
        ? {}
        : inner.frontmatterProperties(frontmatter);
    },
  };
}

function setup() {
  const task = jsonLinesNote({ type: 'task', status: 'next-action', tags: ['a'] });
  const twice = task.replace('tags: ["a"]\n', 'tags: ["a"]\ntags: ["b"]\n');
  const vault = proposalVault({
    '.atlas/types/task.md': jsonLinesNote({
      name: 'task',
      properties: { project: { kind: 'relation', target: 'project', many: false } },
    }),
    [TASK]: twice,
  });
  return { ...vault.ports, markdown: duplicateAwareMarkdown() };
}

describe('a link proposal through a task whose block lists an unrelated key twice', () => {
  it('finds the relation it links through', async () => {
    const ports = setup();
    const link = await readLinkNote(ports, { note: vaultPath(TASK), property: 'project' });
    expect(link?.target.relation).toEqual({ many: false });
  });

  it('holds its change to the task rules: finishing the task dates it', async () => {
    const ports = setup();
    const link = await readLinkNote(ports, { note: vaultPath(TASK), property: 'project' });
    const ruled = heldToTaskRules(ports, {
      write: { kind: 'set', path: vaultPath(TASK), changes: { status: 'archive' } },
      link,
      today: TODAY,
    });
    expect(ruled).toMatchObject({ changes: { status: 'archive', completed: TODAY } });
  });
});

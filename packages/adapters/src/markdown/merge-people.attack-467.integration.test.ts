/**
 * Adversarial pass on PR #467 (merge duplicate people, #464) through the real
 * frontmatter reader and writer: the kept note's YAML as a person wrote it —
 * comments, odd spacing, an address as a string beside one as a list — and a
 * relation written in YAML. Invariant: the merge only adds, byte for byte
 * around what it adds (ADR-0003). Fictional names only.
 */
import { describe, expect, it } from 'vitest';
import { createVaultPath, splitFrontmatter, type VaultPath } from '@atlas/domain';
import {
  applyPeopleMerge,
  previewPeopleMerge,
  type IndexPort,
  type MergePorts,
  type VaultFsPort,
} from '@atlas/application';
import { remarkMarkdown } from './markdown-port.ts';

const p = createVaultPath;

function vaultOf(notes: Record<string, string>, holders: readonly string[]) {
  const files = new Map(Object.entries(notes).map(([path, text]) => [path, { text, modified: 1 }]));
  const fs: Partial<VaultFsPort> = {
    readNotes: async (paths) =>
      paths.flatMap((path) => {
        const file = files.get(path);
        return file === undefined ? [] : [{ path, ...file, size: file.text.length }];
      }),
    writeTextFile: async ({ path, contents, expectedText }) => {
      const file = files.get(path);
      if (file === undefined || file.text !== expectedText) throw new Error('changed on disk');
      files.set(path, { text: contents, modified: file.modified + 1 });
      return file.modified + 1;
    },
    trashEntry: async ({ path }) => {
      files.delete(path);
    },
  };
  // Only the holders question is asked of the index here: answer it from `holders`.
  const index: Partial<IndexPort> = {
    query: async (sql) => ({
      columns: ['path'],
      rows: sql.startsWith('SELECT DISTINCT src') ? holders.map((path) => [path]) : [],
      truncated: false,
    }),
    remove: async () => {},
  };
  const ports: MergePorts = {
    fs: fs as VaultFsPort,
    index: index as IndexPort,
    markdown: remarkMarkdown,
    editors: { state: () => 'closed', flush: async () => {}, abandon: () => {}, reload: () => {} },
  };
  const merge = async (keep: string, merge: string[]) => {
    const notePaths = [...files.keys()].map(p);
    const preview = await previewPeopleMerge({
      ports,
      request: { keep: p(keep), merge: merge.map(p) as VaultPath[] },
      notePaths,
    });
    expect(preview.refusal).toBeNull();
    await applyPeopleMerge({ ports, preview });
    return preview;
  };
  return { files, merge, text: (path: string) => files.get(path)?.text };
}

const KEPT = 'People/Mara Quill.md';
const SHORT = 'Mara.md';

describe('the kept note’s frontmatter through a merge (attack-467)', () => {
  it('keeps every comment and spacing of the kept note’s YAML, adding only the merged keys', async () => {
    const keptYaml =
      '---\n' +
      '# who she is\n' +
      'type:   person   # spaced out\n' +
      'email: mara.quill@larkspur.example.com\n' +
      'role: Payroll lead\n' +
      '---\n';
    const { text, merge } = vaultOf(
      {
        [KEPT]: `${keptYaml}Leads payroll.\n`,
        [SHORT]: '---\ntype: person\nemail:\n  - mara@larkspur.example.com\n---\nShort copy.\n',
      },
      [],
    );
    await merge(KEPT, [SHORT]);
    const after = splitFrontmatter(text(KEPT)!).frontmatter!;
    for (const line of keptYaml.split('\n').filter((each) => each !== '' && each !== '---')) {
      expect(after).toContain(`${line}\n`);
    }
    const properties = remarkMarkdown.frontmatterProperties(after);
    expect(properties['other_emails']).toEqual(['mara@larkspur.example.com']);
    expect(properties['aliases']).toEqual(['Mara']);
  });

  it('re-points a relation written in YAML and leaves the rest of its line byte for byte', async () => {
    const { text, merge } = vaultOf(
      {
        [KEPT]: '---\ntype: person\n---\n',
        [SHORT]: '---\ntype: person\n---\n',
        'Kickoff.md':
          "---\nattendees: ['[[Mara]]', \"[[Tobias Fenn]]\"]  # who came\nowner: '[[Mara|M]]'\n---\nBody.\n",
        'Tobias Fenn.md': '---\ntype: person\n---\n',
      },
      ['Kickoff.md'],
    );
    await merge(KEPT, [SHORT]);
    expect(text('Kickoff.md')).toBe(
      "---\nattendees: ['[[Mara Quill]]', \"[[Tobias Fenn]]\"]  # who came\nowner: '[[Mara Quill|M]]'\n---\nBody.\n",
    );
  });
});

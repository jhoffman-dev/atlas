import type { VaultEntry } from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import { fakeMarkdown, fakeVaultFs } from './fake-ports.ts';

/** Frontmatter as JSON, so a list survives the round trip the plain fake flattens. */
export function jsonMarkdown(): MarkdownPort {
  const inner = (frontmatter: string | null) =>
    (frontmatter ?? '')
      .replace(/^---\n/, '')
      .replace(/---\n$/, '')
      .trim() || '{}';
  const problem = (frontmatter: string | null): string | null => {
    try {
      JSON.parse(inner(frontmatter));
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    }
  };
  // Like the real port, a block that cannot be read has no properties.
  const read = (frontmatter: string | null): Record<string, unknown> =>
    problem(frontmatter) === null
      ? (JSON.parse(inner(frontmatter)) as Record<string, unknown>)
      : {};
  return {
    ...fakeMarkdown(),
    frontmatterProperties: read,
    frontmatterProblem: problem,
    updateFrontmatter: (frontmatter, changes) =>
      `---\n${JSON.stringify({ ...read(frontmatter), ...changes })}\n---\n`,
  };
}

/** A vault holding the given files, which records every write. */
export function vaultWith(files: Record<string, string>, root: readonly VaultEntry[] = []) {
  const written: Record<string, string> = { ...files };
  const created: string[] = [];
  const folders: string[] = [];
  const fs = fakeVaultFs({
    listDirectory: async () => root,
    readNotes: async (paths) =>
      paths
        .filter((path) => written[path] !== undefined)
        .map((path) => ({ path, text: written[path] ?? '', modified: 1, size: 1 })),
    readTextFile: async (path) => ({ text: written[path] ?? '', modified: 1 }),
    writeTextFile: async ({ path, contents }) => {
      written[path] = contents;
      return 2;
    },
    createNote: async ({ path, contents }) => {
      created.push(path);
      written[path] = contents;
    },
    createFolder: async ({ path }) => {
      folders.push(path);
    },
  });
  return { fs, written, created, folders };
}

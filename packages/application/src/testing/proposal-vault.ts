import { createVaultPath, type VaultPath } from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import type { ProposalPorts } from '../proposals/index.ts';
import { apiFixture, type ApiFixture } from './api-fixture.ts';
import { fakeMarkdown } from './fake-ports.ts';

/**
 * Frontmatter as `key: <JSON>` lines, so a proposal's nested `payload` reads
 * back as it was written. How the real YAML writer keeps every other byte is
 * the adapters' business, tested there. Test support only.
 */
export function jsonLinesMarkdown(): MarkdownPort {
  const read = (frontmatter: string | null): Map<string, unknown> =>
    new Map(
      (frontmatter ?? '')
        .split('\n')
        .map((line) => /^([^:\s][^:]*): (.*)$/.exec(line))
        .filter((found) => found !== null)
        .map((found) => [found[1] ?? '', JSON.parse(found[2] ?? 'null') as unknown]),
    );
  return {
    ...fakeMarkdown(),
    frontmatterProperties: (frontmatter) => Object.fromEntries(read(frontmatter)),
    updateFrontmatter: (frontmatter, changes) => {
      const merged = read(frontmatter);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === undefined) merged.delete(key);
        else merged.set(key, value);
      }
      const lines = [...merged].map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
      return ['---', ...lines, '---', ''].join('\n');
    },
  };
}

/** A note whose frontmatter is `properties`, as `jsonLinesMarkdown` writes it. */
export function jsonLinesNote(properties: Readonly<Record<string, unknown>>, body = ''): string {
  return jsonLinesMarkdown().updateFrontmatter(null, properties) + body;
}

export interface ProposalVault {
  readonly fixture: ApiFixture;
  readonly ports: ProposalPorts;
  /** The properties of the note at `path`, as the markdown port reads them; null when it is gone. */
  propertiesOf(path: string): Record<string, unknown> | null;
  /** Every note path in the vault now. */
  paths(): string[];
  /** The panes with unsaved typing, by path; a test adds to it. */
  readonly dirty: Set<string>;
}

/** An in-memory vault the proposal use-cases run against, whose Trash takes notes away. */
export function proposalVault(files: Record<string, string>): ProposalVault {
  const fixture = apiFixture({ files, markdown: jsonLinesMarkdown() });
  const markdown = jsonLinesMarkdown();
  const dirty = new Set<string>();
  const fs = {
    ...fixture.fs,
    trashEntry: async ({ path }: { path: VaultPath }) => {
      if (!fixture.files.delete(path)) throw new Error(`nothing at ${path}`);
    },
  };
  const panes = fixture.deps.movingNotes;
  const ports: ProposalPorts = {
    fs,
    index: fixture.deps.index,
    markdown,
    editors: { ...panes, state: (path) => (dirty.has(path) ? 'dirty' : panes.state(path)) },
  };
  return {
    fixture,
    ports,
    dirty,
    paths: () => [...fixture.files.keys()].sort(),
    propertiesOf: (path) => {
      const note = fixture.files.get(path);
      if (note === undefined) return null;
      const frontmatter = /^---\n[\s\S]*?\n---\n/.exec(note.text)?.[0] ?? null;
      return markdown.frontmatterProperties(frontmatter);
    },
  };
}

export const vaultPath = (raw: string): VaultPath => createVaultPath(raw);

import {
  relationTargets,
  relationTypeRefusal,
  resolveWikiLinkTarget,
  splitFrontmatter,
  type PropertyDef,
  type VaultPath,
} from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { noteTypeName } from './load-types.ts';

/**
 * Why each relation in `values` cannot hold what it links, by key: a link to
 * a note of a type the relation does not point at — a Project linking a
 * person (P30-01). Only a link to a note that is there, and says its type, is
 * judged; one naming a note not written yet, or one with no `type:`, is let
 * through, as a link may name a note before it exists.
 */
export async function linkedTypeProblems({
  fs,
  markdown,
  properties,
  values,
  notePaths,
}: {
  fs: Pick<VaultFsPort, 'readNotes'>;
  markdown: Pick<MarkdownPort, 'frontmatterProperties'>;
  /** The note's type's properties; only its relations are looked at. */
  properties: readonly PropertyDef[];
  values: Readonly<Record<string, unknown>>;
  notePaths: readonly VaultPath[];
}): Promise<Readonly<Record<string, string>>> {
  const links = properties
    .filter((def) => def.kind === 'relation' && Object.hasOwn(values, def.key))
    .flatMap((def) =>
      relationTargets(values[def.key]).flatMap((target) => {
        const path = resolveWikiLinkTarget(target, notePaths);
        return path === null ? [] : [{ def, path }];
      }),
    );
  if (links.length === 0) return {};
  const typeOf = await linkedNoteTypes({ fs, markdown, paths: links.map((link) => link.path) });
  const problems: Record<string, string> = {};
  for (const { def, path } of links) {
    const refusal = relationTypeRefusal({ def, linkedType: typeOf.get(path) ?? null });
    if (refusal !== null && !Object.hasOwn(problems, def.key)) problems[def.key] = refusal;
  }
  return problems;
}

/** The `type:` of each note, read from its file; a note with none is left out. */
async function linkedNoteTypes({
  fs,
  markdown,
  paths,
}: {
  fs: Pick<VaultFsPort, 'readNotes'>;
  markdown: Pick<MarkdownPort, 'frontmatterProperties'>;
  paths: readonly VaultPath[];
}): Promise<ReadonlyMap<string, string>> {
  const files = await fs.readNotes([...new Set(paths)]);
  return new Map(
    files.flatMap((file) => {
      const type = noteTypeName(
        markdown.frontmatterProperties(splitFrontmatter(file.text).frontmatter),
      );
      return type === null ? [] : [[file.path, type] as const];
    }),
  );
}

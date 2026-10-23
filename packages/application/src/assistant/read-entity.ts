import {
  assistantPageRefusal,
  linkedPageType,
  noteTitle,
  splitFrontmatter,
  type AssistantTool,
  type ObjectType,
  type VaultPath,
} from '@dfai/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import { noteTypeName } from '../types/load-types.ts';
import { VaultAccessError, type VaultFsPort } from '../vault/ports.ts';

/** Why the note an assistant tool was asked about cannot be answered about. */
export class AssistantEntityError extends Error {
  constructor(
    readonly reason: 'not_found' | 'not_a_page',
    message: string,
  ) {
    super(message);
    this.name = 'AssistantEntityError';
  }
}

/** The page a tool answers about, as its own note says it. */
export interface AssistantEntity {
  readonly path: VaultPath;
  readonly title: string;
  /** Its `type:`, as written. */
  readonly type: string;
  /** Its own `status:`, as written: a project's says whether it should be moving. */
  readonly status: string | null;
  readonly frontmatter: Readonly<Record<string, unknown>>;
}

/**
 * Reads the one note a tool is asked about — its type, title and status —
 * and refuses one the vault does not hold, the tool does not answer about,
 * or whose type the vault does not declare.
 * Only that note is read; everything else comes from the index.
 */
export async function readAssistantEntity({
  fs,
  markdown,
  path: asked,
  notePaths,
  types,
  tool,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  path: VaultPath;
  notePaths: readonly VaultPath[];
  types: readonly ObjectType[];
  tool: AssistantTool;
}): Promise<AssistantEntity> {
  const path = spelledAsNotes(asked, notePaths);
  if (path === null) throw new AssistantEntityError('not_found', `No note at ${asked}`);
  const text = await readText(fs, path);
  const frontmatter = markdown.frontmatterProperties(splitFrontmatter(text).frontmatter);
  const type = noteTypeName(frontmatter);
  const refusal = assistantPageRefusal(tool, type);
  if (refusal !== null || type === null) {
    throw new AssistantEntityError('not_a_page', refusal ?? 'entity has no type');
  }
  // With no such type, the vault's page shows no sections: an empty answer would say "nothing".
  if (!types.some((each) => linkedPageType(each.name) === linkedPageType(type))) {
    throw new AssistantEntityError(
      'not_a_page',
      `The vault has no ${type} type to read its page by`,
    );
  }
  const title = frontmatter['title'];
  const status = frontmatter['status'];
  return {
    path,
    title: typeof title === 'string' && title.trim() !== '' ? title.trim() : noteTitle(path),
    type,
    status: typeof status === 'string' ? status : null,
    frontmatter,
  };
}

/**
 * The note `asked` names, as the vault spells it: macOS hands a name out
 * decomposed (`e` and an accent) where the note is composed, and the same
 * name is one name (A21-02). Null when no note has it.
 */
function spelledAsNotes(asked: VaultPath, notePaths: readonly VaultPath[]): VaultPath | null {
  if (notePaths.includes(asked)) return asked;
  const composed = asked.normalize('NFC');
  return notePaths.find((note) => note.normalize('NFC') === composed) ?? null;
}

async function readText(fs: VaultFsPort, path: VaultPath): Promise<string> {
  try {
    return (await fs.readTextFile(path)).text;
  } catch (error) {
    if (error instanceof VaultAccessError) {
      throw new AssistantEntityError('not_found', `No note at ${path}`);
    }
    throw error;
  }
}

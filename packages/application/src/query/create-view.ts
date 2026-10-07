import {
  newViewNote,
  newViewProblems,
  viewNameProblem,
  viewPathFor,
  type NewViewRequest,
  type ObjectType,
  type VaultPath,
} from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/** A view that could not be made, with the reason as it should be shown. */
export class ViewRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'ViewRefusedError';
  }
}

interface ViewWrite {
  readonly fs: VaultFsPort;
  readonly markdown: MarkdownPort;
  /** Every saved view's path, so a name already taken is refused before the write. */
  readonly takenPaths: readonly string[];
}

/**
 * Makes a view from the New view dialog: the rules decide whether it can be
 * made and what it says, then the note is written.
 */
export async function createView({
  request,
  types,
  ...write
}: ViewWrite & { request: NewViewRequest; types: readonly ObjectType[] }): Promise<VaultPath> {
  const [problem] = newViewProblems(request, { types, takenPaths: write.takenPaths });
  if (problem !== undefined) throw new ViewRefusedError(problem);
  const type = types.find((candidate) => candidate.name === request.type);
  if (type === undefined) throw new ViewRefusedError('That type no longer exists.');
  const note = newViewNote(request, type);
  return writeViewNote({ ...write, name: request.name, frontmatter: note.frontmatter });
}

/**
 * Writes a view note that has been worked out already — a copy of a view with
 * its edits, or a SQL query saved as one — under a name that has been checked.
 */
export async function writeViewNote({
  fs,
  markdown,
  takenPaths,
  name,
  frontmatter,
  heading = name,
}: ViewWrite & {
  name: string;
  frontmatter: Readonly<Record<string, unknown>>;
  /** What the view is called, where its file name could not say it all. */
  heading?: string;
}): Promise<VaultPath> {
  const problem = viewNameProblem(name, takenPaths);
  if (problem !== null) throw new ViewRefusedError(problem);
  const path = viewPathFor(name);
  const head = markdown.updateFrontmatter(null, frontmatter);
  // A heading, so the file reads as what it is when opened anywhere else.
  await fs.createNote({ path, contents: `${head}\n# ${heading.trim()}\n` });
  return path;
}

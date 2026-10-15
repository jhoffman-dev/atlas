import {
  compileParaCandidatesQuery,
  createVaultPath,
  noteTitle,
  PARA_KEY,
  PARA_PROPERTY,
  paraMoveLine,
  paraNoteMove,
  PROJECT_TYPE,
  PROJECT_TYPE_FILE,
  splitFrontmatter,
  typeSetupLines,
  type TypeExtension,
  type VaultPath,
} from '@atlas/domain';
import { UNSAVED_TYPING } from '../automations/apply-changes.ts';
import type { LeftFile, MigrationPanes } from '../gtd/run-task-migration.ts';
import type { IndexPort } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { saveObjectType } from '../types/edit-types.ts';
import { writeTypeFiles } from '../types/ensure-built-in-types.ts';
import { loadObjectTypes, TYPES_FOLDER, type DefinedType } from '../types/load-types.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/** What the move onto the Project type reads the vault through. */
export interface ParaMigrationPorts {
  readonly fs: VaultFsPort;
  readonly markdown: MarkdownPort;
  readonly index: Pick<IndexPort, 'query'>;
}

/** One note's line in the preview. */
export interface ParaNoteLine {
  readonly path: VaultPath;
  readonly title: string;
  /** "Garden: Area → Project, PARA Area". */
  readonly line: string;
}

/**
 * What moving the vault's PARA notes onto the one Project type would do
 * (#213), shown before any of it is done: every note that moves, and what
 * the Project type gains for them.
 */
export interface ParaMigrationPreview {
  readonly typeLines: readonly string[];
  readonly notes: readonly ParaNoteLine[];
}

/** What a run did: each note written, and each left as it was and why. */
export interface ParaMigrationReport {
  readonly written: readonly VaultPath[];
  readonly left: readonly LeftFile[];
}

/** A note's frontmatter as it will be written, and its body as it is. */
interface NoteEdit {
  readonly path: VaultPath;
  /** When it was read: a file changed since is refused rather than overwritten. */
  readonly modified: number;
  readonly after: string;
  readonly body: string;
}

/** What the Project type needs before the notes are moved onto it. */
type TypeChange =
  | { readonly kind: 'none' }
  | { readonly kind: 'create' }
  | { readonly kind: 'extend'; readonly extension: TypeExtension<DefinedType> };

interface ParaMigrationPlan {
  readonly preview: ParaMigrationPreview;
  readonly type: TypeChange;
  readonly edits: readonly NoteEdit[];
}

/** Whether the move has any note left to move: none means the vault's PARA is all one type. */
export function hasParaMigrationWork(preview: ParaMigrationPreview): boolean {
  return preview.notes.length > 0;
}

/** What moving the vault's PARA notes onto the Project type would do, from the files as they are. */
export async function previewParaMigration(
  ports: ParaMigrationPorts,
): Promise<ParaMigrationPreview> {
  return (await planParaMigration(ports)).preview;
}

const folded = (name: string) => name.trim().toLowerCase();

async function planParaMigration(ports: ParaMigrationPorts): Promise<ParaMigrationPlan> {
  const types = await loadObjectTypes(ports);
  const projects = types.filter((type) => folded(type.name) === PROJECT_TYPE);
  const [project] = projects;
  const projectType = projects.length === 1 && project !== undefined ? project.name : PROJECT_TYPE;
  const notes = await readCandidates(ports);
  const moved = notes.flatMap((note) => {
    const move = paraNoteMove({ path: note.path, properties: note.properties, projectType });
    if (move === null) return [];
    const title = noteTitle(note.path);
    return [
      {
        line: { path: note.path, title, line: paraMoveLine({ title, move }) },
        edit: {
          path: note.path,
          modified: note.modified,
          after: ports.markdown.updateFrontmatter(note.frontmatter, move.changes),
          body: note.body,
        },
      },
    ];
  });
  const type = typeChange(projects);
  return {
    preview: { typeLines: typeLines(type), notes: moved.map((move) => move.line) },
    type,
    edits: moved.map((move) => move.edit),
  };
}

/**
 * What the Project type needs for the moved notes' PARA to show: the type
 * itself in a vault with none, `para` on one without it. Nothing on a type
 * two files claim — which one a feature reads is not the move's to pick.
 */
function typeChange(projects: readonly DefinedType[]): TypeChange {
  const [project, ...others] = projects;
  if (project === undefined) return { kind: 'create' };
  if (others.length > 0 || project.properties.some((property) => property.key === PARA_KEY)) {
    return { kind: 'none' };
  }
  const extension: TypeExtension<DefinedType> = {
    before: project,
    after: { ...project, properties: [...project.properties, PARA_PROPERTY] },
    added: [PARA_PROPERTY],
    widened: [],
  };
  return { kind: 'extend', extension };
}

function typeLines(change: TypeChange): readonly string[] {
  if (change.kind === 'none') return [];
  if (change.kind === 'create')
    return typeSetupLines({ types: [PROJECT_TYPE_FILE], extensions: [] });
  return typeSetupLines({ types: [], extensions: [change.extension] });
}

interface CandidateNote {
  readonly path: VaultPath;
  readonly modified: number;
  readonly frontmatter: string;
  readonly body: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

/**
 * The notes that may move, read from their files: every note the index says
 * is of the Area, Resource or Project type, in any spelling, for
 * `paraNoteMove` to judge from what each file says.
 */
async function readCandidates(ports: ParaMigrationPorts): Promise<CandidateNote[]> {
  const { sql, parameters } = compileParaCandidatesQuery();
  const result = await ports.index.query(sql, parameters);
  const at = result.columns.indexOf('path');
  const paths = result.rows.map((row) => row[at]).filter((path) => typeof path === 'string');
  if (paths.length === 0) return [];
  const files = await ports.fs.readNotes(paths);
  return files.flatMap((file) => {
    const { frontmatter, body } = splitFrontmatter(file.text);
    if (frontmatter === null) return [];
    return [
      {
        path: createVaultPath(file.path),
        modified: file.modified,
        frontmatter,
        body,
        properties: ports.markdown.frontmatterProperties(frontmatter),
      },
    ];
  });
}

/**
 * Carries out a previewed move onto the Project type (#213). What each note
 * gets is worked out again from the files as they are now, and only for the
 * notes the preview showed: one moved since is left alone, and one that
 * arrived since waits for the next preview. Running it again moves nothing.
 *
 * The Project type is given `para` first — or written, in a vault without
 * one — through the byte-preserving write the type editor uses. Then each
 * note's `type` and `para`, and nothing else, through the host's refusal to
 * write over a file that changed after it was read; a note with unsaved
 * typing in a pane is never written. One that cannot be written is reported
 * and the rest carry on.
 */
export async function runParaMigration({
  ports,
  panes,
  preview,
}: {
  ports: ParaMigrationPorts;
  panes: MigrationPanes;
  preview: ParaMigrationPreview;
}): Promise<ParaMigrationReport> {
  const plan = await planParaMigration(ports);
  const shown = new Set(preview.notes.map((note) => note.path));
  const edits = plan.edits.filter((edit) => shown.has(edit.path));
  if (edits.length === 0) return { written: [], left: [] };
  const left: LeftFile[] = [...(await changeType(ports, plan.type))];
  const written: VaultPath[] = [];
  for (const edit of edits) {
    const reason = await writeEdit(ports.fs, panes, edit);
    if (reason === null) written.push(edit.path);
    else left.push({ path: edit.path, reason });
  }
  return { written, left };
}

/** Gives the Project type what the moved notes need; the type's file, and why, if it could not be. */
async function changeType(ports: ParaMigrationPorts, change: TypeChange): Promise<LeftFile[]> {
  if (change.kind === 'none') return [];
  if (change.kind === 'create') {
    const { failed } = await writeTypeFiles(ports, [PROJECT_TYPE_FILE]);
    return failed.map(({ reason }) => ({ path: projectTypePath(), reason }));
  }
  const { before, after } = change.extension;
  try {
    await saveObjectType({ ...ports, path: before.path, before, type: after });
    return [];
  } catch (cause) {
    return [{ path: before.path, reason: reasonOf(cause) }];
  }
}

const projectTypePath = () => createVaultPath(`${TYPES_FOLDER}/${PROJECT_TYPE}.md`);

/** Writes one note's edit; why it was not written, or null. */
async function writeEdit(
  fs: VaultFsPort,
  panes: MigrationPanes,
  { path, modified, after, body }: NoteEdit,
): Promise<string | null> {
  if (panes.state(path) === 'dirty') return UNSAVED_TYPING;
  try {
    await fs.writeTextFile({ path, contents: after + body, expectedModified: modified });
  } catch (cause) {
    return reasonOf(cause);
  }
  if (panes.state(path) === 'clean') panes.reload(path);
  return null;
}

const reasonOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

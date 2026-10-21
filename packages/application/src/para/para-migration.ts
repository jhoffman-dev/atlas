import {
  compileParaCandidatesQuery,
  createVaultPath,
  noteTitle,
  PARA_KEY,
  PARA_PROPERTY,
  paraMoveLine,
  paraMoveRefusal,
  paraNoteMove,
  paraSkipLine,
  PROJECT_TYPE,
  PROJECT_TYPE_FILE,
  splitFrontmatter,
  typeSetupLines,
  vaultProjectTypeName,
  type TypeExtension,
  type VaultPath,
} from '@dfai/domain';
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

/** A note that moves, as the preview read it, and the file it is written as. */
export interface ParaNoteMoveLine extends ParaNoteLine {
  /** The file as the preview read it: one that differs when the move runs is left as it is. */
  readonly read: string;
  /** When the preview read it: the host refuses the write over a file changed since. */
  readonly modified: number;
  /** The file as the move writes it: the preview's own reading, with `type` and `para` set. */
  readonly contents: string;
}

/**
 * What moving the vault's PARA notes onto the one Project type would do
 * (#213), shown before any of it is done: every note that moves, what the
 * Project type gains for them, and each note left as it is and why.
 */
export interface ParaMigrationPreview {
  readonly typeLines: readonly string[];
  readonly notes: readonly ParaNoteMoveLine[];
  /** Notes the move would change but leaves as they are: "Garden: its PARA “Life admin” is not …". */
  readonly skipped: readonly ParaNoteLine[];
}

/** What a run did: each note written, and each left as it was and why. */
export interface ParaMigrationReport {
  readonly written: readonly VaultPath[];
  readonly left: readonly LeftFile[];
}

/** What the Project type needs before the notes are moved onto it. */
type TypeChange =
  | { readonly kind: 'none' }
  | { readonly kind: 'create' }
  | { readonly kind: 'extend'; readonly extension: TypeExtension<DefinedType> };

/** Whether the move has any note left to move: none means the vault's PARA is all one type. */
export function hasParaMigrationWork(preview: ParaMigrationPreview): boolean {
  return preview.notes.length > 0;
}

/** What moving the vault's PARA notes onto the Project type would do, from the files as they are. */
export async function previewParaMigration(
  ports: ParaMigrationPorts,
): Promise<ParaMigrationPreview> {
  const types = await loadObjectTypes(ports);
  const projectType = vaultProjectTypeName(types) ?? PROJECT_TYPE;
  const notes: ParaNoteMoveLine[] = [];
  const skipped: ParaNoteLine[] = [];
  for (const note of await readCandidates(ports)) {
    const move = paraNoteMove({ path: note.path, properties: note.properties, projectType });
    if (move === null) continue;
    const title = noteTitle(note.path);
    const refusal = paraMoveRefusal(note.properties);
    if (refusal !== null) {
      skipped.push({ path: note.path, title, line: paraSkipLine({ title, reason: refusal }) });
      continue;
    }
    const after = ports.markdown.updateFrontmatter(note.frontmatter, move.changes);
    notes.push({
      path: note.path,
      title,
      line: paraMoveLine({ title, move }),
      read: note.text,
      modified: note.modified,
      contents: after + note.body,
    });
  }
  return { typeLines: typeLines(typeChange(projectTypes(types))), notes, skipped };
}

const folded = (name: string) => name.trim().toLowerCase();

const projectTypes = (types: readonly DefinedType[]) =>
  types.filter((type) => folded(type.name) === PROJECT_TYPE);

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
  /** The whole file, as read, and when. */
  readonly text: string;
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
        text: file.text,
        modified: file.modified,
        frontmatter,
        body,
        properties: ports.markdown.frontmatterProperties(frontmatter),
      },
    ];
  });
}

/**
 * Carries out a previewed move onto the Project type (#213): each note the
 * preview showed is written as the preview said, and only if its file is
 * still as the preview read it — one changed since is left as it was and
 * reported, and one that arrived since waits for the next preview. Running
 * it again moves nothing.
 *
 * The Project type is given `para` first — or written, in a vault without
 * one — through the byte-preserving write the type editor uses. Then each
 * note, through the host's refusal to write over a file that changed after it
 * was read; a note with unsaved typing in a pane is never written. One that
 * cannot be written is reported and the rest carry on.
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
  if (preview.notes.length === 0) return { written: [], left: [] };
  const type = typeChange(projectTypes(await loadObjectTypes(ports)));
  const left: LeftFile[] = [...(await changeType(ports, type))];
  const written: VaultPath[] = [];
  for (const note of preview.notes) {
    const reason = await writeNote(ports.fs, panes, note);
    if (reason === null) written.push(note.path);
    else left.push({ path: note.path, reason });
  }
  return { written, left };
}

/** Why a note was left as it was: what the preview read of it is no longer what it says. */
export const CHANGED_SINCE_PREVIEW = 'It changed since the preview read it.';

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

/** Writes one note as the preview said; why it was not written, or null. */
async function writeNote(
  fs: VaultFsPort,
  panes: MigrationPanes,
  { path, read, modified, contents }: ParaNoteMoveLine,
): Promise<string | null> {
  if (panes.state(path) === 'dirty') return UNSAVED_TYPING;
  try {
    if ((await fs.readTextFile(path)).text !== read) return CHANGED_SINCE_PREVIEW;
    await fs.writeTextFile({ path, contents, expectedModified: modified });
  } catch (cause) {
    return reasonOf(cause);
  }
  if (panes.state(path) === 'clean') panes.reload(path);
  return null;
}

const reasonOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

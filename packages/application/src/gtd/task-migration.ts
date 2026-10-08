import {
  automationStatusRewrite,
  compileTaskStatusesQuery,
  isGtdStatus,
  createVaultPath,
  foldedVaultPath,
  GTD_VIEW_FILES,
  holdsTypeValues,
  isAutomationPath,
  noteTitle,
  queryViewFrontmatter,
  splitFrontmatter,
  statusMappingFor,
  statusValueOf,
  TASK_TYPE,
  TASK_TYPE_FILE,
  taskStatusChanges,
  taskStatusMove,
  taskTypeChange,
  taskTypeLines,
  typeFrontmatterChanges,
  viewStatusRewrite,
  VIEWS_DIRECTORY,
  type GtdStatus,
  type StatusMapping,
  type StatusRewrite,
  type VaultPath,
} from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { builtInTypeContents } from '../types/ensure-built-in-types.ts';
import {
  loadObjectTypes,
  noteTypeName,
  TYPES_FOLDER,
  type DefinedType,
} from '../types/load-types.ts';
import { loadTemplates } from '../types/templates.ts';
import type { NoteFile, VaultFsPort } from '../vault/ports.ts';
import { listVaultNotes } from '../vault/read-vault.ts';

/** What the migration reads the vault through. */
export interface TaskMigrationPorts {
  readonly fs: VaultFsPort;
  readonly markdown: MarkdownPort;
  readonly index: Pick<IndexPort, 'notesOfType' | 'query'>;
  /** `YYYY-MM-DD` where the person is, for a file changed at this time: a finished task's `completed`. */
  readonly dayOf: (modified: number) => string;
}

/** One task's line in the preview: its status now, and what it becomes. */
export interface TaskMove {
  readonly path: VaultPath;
  readonly title: string;
  readonly from: string;
  readonly to: GtdStatus;
  /** The day written as `completed`, when it becomes finished without one. */
  readonly completed: string | null;
  /** Why it does not go where the mapping sends it — Waiting with nobody to wait on — or null. */
  readonly held: string | null;
}

/** A view or an automation that names an old status, and what it will say. */
export interface ReferenceMove {
  readonly path: VaultPath;
  readonly title: string;
  readonly moved: readonly string[];
}

/** A view or an automation the migration cannot rewrite, listed for James. */
export interface ListedReference {
  readonly path: VaultPath;
  readonly title: string;
  readonly reason: string;
}

/**
 * Everything the migration would do, shown before it does any of it
 * (ADR-0029): every task old → new, the Task type's change, the views and
 * automations rewritten or listed, and the GTD views added.
 */
export interface TaskMigrationPreview {
  /** Each old status found, and the GTD status it becomes; the person may change any of them. */
  readonly mapping: StatusMapping;
  /** The Task type's file, and what changes in it; null when it already follows GTD. */
  readonly type: { readonly path: VaultPath; readonly lines: readonly string[] } | null;
  readonly tasks: readonly TaskMove[];
  readonly references: readonly ReferenceMove[];
  readonly listed: readonly ListedReference[];
  /** The GTD views the vault has none of the name of, to be added. */
  readonly views: readonly VaultPath[];
}

/** A file the migration changes: its frontmatter as it is and as it will be, and its body as it is. */
export interface FileEdit {
  readonly path: VaultPath;
  /** When it was read: a file changed since is refused rather than overwritten. */
  readonly modified: number;
  readonly before: string;
  readonly after: string;
  readonly body: string;
}

/** A file the migration adds. */
export interface FileCreation {
  readonly path: VaultPath;
  readonly contents: string;
}

/** The preview, and the writes that would carry it out, worked out from the files as they are. */
export interface TaskMigrationPlan {
  readonly preview: TaskMigrationPreview;
  /** The Task type's file first, then the tasks, then the views and automations. */
  readonly edits: readonly FileEdit[];
  readonly creations: readonly FileCreation[];
}

/** Whether a preview has anything left to do: none means the vault already follows GTD. */
export function hasMigrationWork(preview: TaskMigrationPreview): boolean {
  return (
    preview.type !== null ||
    preview.tasks.length + preview.references.length + preview.views.length > 0
  );
}

/**
 * Whether the move to GTD may have anything left to do, judged without
 * reading every task: false only when the Task type already follows GTD and
 * the index holds no task whose status is not one of the eight. The Inbox
 * asks this on every open, and reads the tasks only when it says yes.
 */
export async function taskMigrationNeeded(
  ports: Pick<TaskMigrationPorts, 'fs' | 'markdown' | 'index'>,
): Promise<boolean> {
  const own = taskTypeOf(await loadObjectTypes(ports));
  if (own === null || taskTypeChange(own) !== null) return true;
  const { sql, parameters } = compileTaskStatusesQuery(own.name);
  const result = await ports.index.query(sql, parameters);
  const status = result.columns.indexOf('status');
  return result.rows.some((row) => !isGtdStatus(row[status]));
}

const taskTypeOf = (types: readonly DefinedType[]): DefinedType | null =>
  types.find((type) => type.name.trim().toLowerCase() === TASK_TYPE) ?? null;

/**
 * What moving the vault's tasks to GTD would do, read from the files as they
 * are now — nothing is written. `chosen` is the person's own mapping for any
 * old status; the rest take ADR-0029's defaults.
 */
export async function previewTaskMigration(
  ports: TaskMigrationPorts,
  chosen?: StatusMapping,
): Promise<TaskMigrationPreview> {
  return (await planTaskMigration(ports, chosen)).preview;
}

/** {@link previewTaskMigration}, with the writes that would carry it out. */
export async function planTaskMigration(
  ports: TaskMigrationPorts,
  chosen?: StatusMapping,
): Promise<TaskMigrationPlan> {
  const own = taskTypeOf(await loadObjectTypes(ports));
  const typeChange = own === null ? null : taskTypeChange(own);
  const tasks = await readTasks(ports, own?.name ?? TASK_TYPE);
  const mapping = statusMappingFor({
    found: [
      ...tasks.map((task) => statusValueOf(task.properties)),
      ...(typeChange?.statusWas ?? []),
    ],
    ...(chosen === undefined ? {} : { chosen }),
  });

  const viewPaths = await viewFiles(ports.fs);
  const automationPaths = (await listVaultNotes(ports)).filter(isAutomationPath);
  const type = await typePlan(ports, own);
  const moves = taskMoves(ports, tasks, mapping);
  const references = await referenceMoves(ports, [...viewPaths, ...automationPaths], mapping);
  const views = viewCreations(ports.markdown, viewPaths);
  return {
    preview: {
      mapping,
      type: type.preview,
      tasks: moves.map((move) => move.line),
      references: references.moved.map((reference) => reference.line),
      listed: references.listed,
      views: views.map((view) => view.path),
    },
    edits: [
      ...type.edits,
      ...moves.map((move) => move.edit),
      ...references.moved.map((reference) => reference.edit),
    ],
    creations: [...type.creations, ...views],
  };
}

interface ReadNote {
  readonly file: NoteFile;
  readonly frontmatter: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

/** Reads notes, keeping those with frontmatter: a file without any says nothing to migrate. */
async function readWithFrontmatter(
  ports: TaskMigrationPorts,
  paths: readonly string[],
): Promise<ReadNote[]> {
  if (paths.length === 0) return [];
  const files = await ports.fs.readNotes(paths);
  return files.flatMap((file) => {
    const { frontmatter } = splitFrontmatter(file.text);
    if (frontmatter === null) return [];
    return [{ file, frontmatter, properties: ports.markdown.frontmatterProperties(frontmatter) }];
  });
}

/**
 * The vault's tasks, and its templates for tasks — a template left saying an
 * old status would make every new task from it start with a value that no
 * longer exists.
 */
async function readTasks(ports: TaskMigrationPorts, typeName: string): Promise<ReadNote[]> {
  const listed = (await ports.index.notesOfType(typeName)).map((note) => note.path);
  const templates = (await loadTemplates(ports)).map((template) => template.path);
  const notes = await readWithFrontmatter(ports, [...new Set([...listed, ...templates])]);
  return notes.filter(
    (note) =>
      holdsTypeValues(note.properties) &&
      noteTypeName(note.properties)?.toLowerCase() === typeName.toLowerCase(),
  );
}

/** The change to one file's frontmatter, as it will be written. */
function fileEdit(
  markdown: MarkdownPort,
  note: ReadNote,
  changes: Readonly<Record<string, unknown>>,
): FileEdit {
  return {
    path: createVaultPath(note.file.path),
    modified: note.file.modified,
    before: note.frontmatter,
    after: markdown.updateFrontmatter(note.frontmatter, changes),
    body: note.file.text.slice(note.frontmatter.length),
  };
}

function taskMoves(ports: TaskMigrationPorts, tasks: readonly ReadNote[], mapping: StatusMapping) {
  return tasks.flatMap((task) => {
    const move = taskStatusMove({
      properties: task.properties,
      mapping,
      lastChanged: ports.dayOf(task.file.modified),
    });
    if (move === null) return [];
    const path = createVaultPath(task.file.path);
    return [
      {
        line: { path, title: noteTitle(path), ...move },
        edit: fileEdit(ports.markdown, task, taskStatusChanges(move)),
      },
    ];
  });
}

/** The Task type's change: its own file edited, or the built-in one written when it has none. */
async function typePlan(
  ports: TaskMigrationPorts,
  own: DefinedType | null,
): Promise<{
  preview: TaskMigrationPreview['type'];
  edits: FileEdit[];
  creations: FileCreation[];
}> {
  if (own === null) {
    const path = createVaultPath(`${TYPES_FOLDER}/${TASK_TYPE}.md`);
    return {
      preview: { path, lines: ['Adds the Task type, with the eight statuses.'] },
      edits: [],
      creations: [{ path, contents: builtInTypeContents(ports.markdown, TASK_TYPE_FILE) }],
    };
  }
  const change = taskTypeChange(own);
  if (change === null) return { preview: null, edits: [], creations: [] };
  const [file] = await readWithFrontmatter(ports, [own.path]);
  if (file === undefined) throw new Error(`The ${own.label} type's file could not be read.`);
  const changes = typeFrontmatterChanges({
    before: own,
    after: change.after,
    written: file.properties,
  });
  return {
    preview: { path: own.path, lines: taskTypeLines(change) },
    edits: [fileEdit(ports.markdown, file, changes)],
    creations: [],
  };
}

/**
 * The view files in `.atlas/views`, where views are kept and where the GTD
 * views are added. The vault's listing leaves that folder out: the sidebar
 * shows it as its own section.
 */
async function viewFiles(fs: VaultFsPort): Promise<VaultPath[]> {
  try {
    const entries = await fs.listDirectory(createVaultPath(VIEWS_DIRECTORY));
    return entries
      .filter((entry) => entry.kind === 'file' && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => entry.path);
  } catch {
    // A vault with no views folder has no views to move, and every GTD view to add.
    return [];
  }
}

/** The views and automations naming an old status: each rewritten, or listed with why it cannot be. */
async function referenceMoves(
  ports: TaskMigrationPorts,
  paths: readonly VaultPath[],
  mapping: StatusMapping,
) {
  const notes = await readWithFrontmatter(ports, paths);
  const moved: { line: ReferenceMove; edit: FileEdit }[] = [];
  const listed: ListedReference[] = [];
  for (const note of notes) {
    const path = createVaultPath(note.file.path);
    const rewrite: StatusRewrite = isAutomationPath(path)
      ? automationStatusRewrite(note.properties, mapping)
      : viewStatusRewrite(note.properties, mapping);
    if (rewrite === null) continue;
    if ('problem' in rewrite) {
      listed.push({ path, title: noteTitle(path), reason: rewrite.problem });
      continue;
    }
    moved.push({
      line: { path, title: noteTitle(path), moved: rewrite.moved },
      edit: fileEdit(ports.markdown, note, rewrite.changes),
    });
  }
  return { moved, listed };
}

/** The GTD views to add: each the vault has no view file of the name of. */
function viewCreations(markdown: MarkdownPort, viewPaths: readonly VaultPath[]): FileCreation[] {
  const taken = new Set(viewPaths.map(foldedVaultPath));
  return GTD_VIEW_FILES.flatMap(({ name, layout, query, body }) => {
    const path = createVaultPath(`${VIEWS_DIRECTORY}/${name}.md`);
    if (taken.has(foldedVaultPath(path))) return [];
    const frontmatter = markdown.updateFrontmatter(null, queryViewFrontmatter({ query, layout }));
    return [{ path, contents: `${frontmatter}\n${body}` }];
  });
}

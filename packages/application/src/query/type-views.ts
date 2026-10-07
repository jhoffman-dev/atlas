import {
  defaultViewTab,
  insertedViewOrder,
  layoutProblem,
  movedViewOrder,
  newTypeViewName,
  newViewNote,
  parseViewDisplay,
  savedViewFrontmatter,
  savedViewSummary,
  splitFrontmatter,
  typeTableQuery,
  typeViews,
  viewCopyNamed,
  viewNameProblem,
  viewNamedAs,
  viewPathFor,
  viewTitleProblem,
  FAVORITE_KEY,
  TITLE_KEY,
  VIEW_ORDER_KEY,
  type ObjectType,
  type SavedViewSummary,
  type VaultPath,
  type ViewLayout,
  type ViewOrderWrite,
} from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { ViewRefusedError, writeViewNote } from './create-view.ts';

/**
 * What changing a type's views needs: the vault, frontmatter, and a way to
 * write a few properties into a view note — through the pane holding it, when
 * one does, so that pane is not left behind the file.
 */
export interface TypeViewPorts {
  readonly fs: VaultFsPort;
  readonly markdown: MarkdownPort;
  readonly writeProperties: (args: {
    path: VaultPath;
    values: Readonly<Record<string, unknown>>;
  }) => Promise<void>;
}

/** The views as the tabs know them, and every view's path, so a new name is free. */
interface KnownViews {
  readonly views: readonly SavedViewSummary[];
  readonly takenPaths: readonly string[];
}

/** A view note just written, with the summary the tabs will read it as. */
export interface WrittenView {
  readonly path: VaultPath;
  readonly summary: SavedViewSummary;
}

/**
 * Writes a type's default table as a file (ADR-0023): the table shown while
 * the type has no views, the same columns and the same title sort, placed
 * first. Called once the tabs are changed — a view added beside it, or it
 * renamed or copied — and refused when the type has views already.
 */
export async function materializeDefaultView({
  ports,
  type,
  views,
  takenPaths,
  name,
}: { ports: TypeViewPorts; type: ObjectType; name?: string } & KnownViews): Promise<WrittenView> {
  if (typeViews(views, type.name).length > 0) {
    throw new ViewRefusedError(`${type.label} has views already.`);
  }
  // Renamed, it is called what was typed — as a written tab is — under the
  // nearest file name a disk holds.
  const naming =
    name === undefined
      ? { fileName: defaultViewTab({ type, takenPaths }).title, title: null }
      : viewNamedAs(name, takenPaths);
  const frontmatter = {
    ...(naming.title === null ? {} : { [TITLE_KEY]: naming.title }),
    ...savedViewFrontmatter(typeTableQuery(type), { ...parseViewDisplay({}), layout: 'table' }),
    [VIEW_ORDER_KEY]: 1,
  };
  return writeView({
    ports,
    name: naming.fileName,
    heading: naming.title ?? naming.fileName,
    frontmatter,
    takenPaths,
  });
}

/**
 * Adds a view to a type from its tabs: named after the type and layout, so
 * nobody is asked for a file name, and placed last. A type showing its default
 * table keeps it — it is written first, so adding a board does not take the
 * table away.
 */
export async function addTypeView({
  ports,
  type,
  layout,
  views,
  takenPaths,
}: {
  ports: TypeViewPorts;
  type: ObjectType;
  layout: ViewLayout;
} & KnownViews): Promise<VaultPath> {
  const problem = layoutProblem(layout, type);
  if (problem !== null) throw new ViewRefusedError(problem);
  const known = await withDefaultWritten({ ports, type, views, takenPaths });
  const name = newTypeViewName({ type, layout, takenPaths: known.takenPaths });
  const note = newViewNote({ name, type: type.name, layout }, type);
  const added = { path: note.path, title: name, type: type.name, layout, order: null };
  const writes = insertedViewOrder({
    views: known.views,
    typeName: type.name,
    added,
    at: Number.POSITIVE_INFINITY,
  });
  await writePlaced({ ports, name, frontmatter: note.frontmatter, writes, ...known });
  return note.path;
}

/**
 * Copies a view as a new tab right after it. The copy is the source's file,
 * byte for byte (ADR-0003) — its comments, the words under its settings, its
 * line endings — but for its title, favourite star and place: it is named for
 * what it copies, and placed by where it lands.
 */
export async function duplicateTypeView({
  ports,
  source,
  views,
  takenPaths,
}: { ports: TypeViewPorts; source: SavedViewSummary } & KnownViews): Promise<VaultPath> {
  const { text } = await ports.fs.readTextFile(source.path);
  const naming = viewCopyNamed(source.title, takenPaths);
  const problem = viewNameProblem(naming.fileName, takenPaths);
  if (problem !== null) throw new ViewRefusedError(problem);

  const path = viewPathFor(naming.fileName);
  const owned = typeViews(views, source.type);
  const at = owned.findIndex((view) => view.path === source.path) + 1;
  const added = { ...source, path, title: naming.title ?? naming.fileName, order: null };
  const writes = insertedViewOrder({ views, typeName: source.type, added, at });
  const own = writes.find((write) => write.path === path);

  const document = splitFrontmatter(text);
  // A null value removes the key, leaving the rest of the block as written.
  const changes = {
    [TITLE_KEY]: naming.title,
    [FAVORITE_KEY]: null,
    [VIEW_ORDER_KEY]: own?.order ?? null,
  };
  await ports.fs.createNote({
    path,
    contents: ports.markdown.updateFrontmatter(document.frontmatter, changes) + document.body,
  });
  await writeOrders(
    ports,
    writes.filter((write) => write.path !== path),
  );
  return path;
}

/** Moves one of a type's tabs to position `to`, writing only the orders that must change. */
export async function moveTypeView({
  ports,
  views,
  typeName,
  path,
  to,
}: {
  ports: TypeViewPorts;
  views: readonly SavedViewSummary[];
  typeName: string;
  path: string;
  to: number;
}): Promise<void> {
  await writeOrders(ports, movedViewOrder({ views, typeName, path, to }));
}

/**
 * Renames a tab. A view's name is its title, so this writes `title:` and
 * leaves the file — and every link to it — where it is. Users never have to
 * know what a view's file is called.
 */
export async function renameTypeView({
  ports,
  path,
  name,
}: {
  ports: TypeViewPorts;
  path: VaultPath;
  name: string;
}): Promise<void> {
  const problem = viewTitleProblem(name);
  if (problem !== null) throw new ViewRefusedError(problem);
  await ports.writeProperties({ path, values: { [TITLE_KEY]: name.trim() } });
}

/**
 * Renames one of a type's tabs. A path the type has no view at is its default
 * table, which is written under the new name rather than renamed.
 */
export async function renameTab({
  ports,
  type,
  path,
  name,
  views,
  takenPaths,
}: {
  ports: TypeViewPorts;
  type: ObjectType;
  path: VaultPath;
  name: string;
} & KnownViews): Promise<VaultPath> {
  if (views.some((view) => view.path === path)) {
    await renameTypeView({ ports, path, name });
    return path;
  }
  const problem = viewTitleProblem(name);
  if (problem !== null) throw new ViewRefusedError(problem);
  return (await materializeDefaultView({ ports, type, name, views, takenPaths })).path;
}

/**
 * Copies one of a type's tabs. A path the type has no view at is its default
 * table, which is written first so there are two tabs afterwards, not one.
 */
export async function duplicateTab({
  ports,
  type,
  path,
  views,
  takenPaths,
}: { ports: TypeViewPorts; type: ObjectType; path: VaultPath } & KnownViews): Promise<VaultPath> {
  const source = views.find((view) => view.path === path);
  if (source !== undefined) return duplicateTypeView({ ports, source, views, takenPaths });
  const written = await materializeDefaultView({ ports, type, views, takenPaths });
  return duplicateTypeView({
    ports,
    source: written.summary,
    views: [...views, written.summary],
    takenPaths: [...takenPaths, written.path],
  });
}

/** The views as they will be once a type showing its default table has it written. */
async function withDefaultWritten({
  ports,
  type,
  views,
  takenPaths,
}: { ports: TypeViewPorts; type: ObjectType } & KnownViews): Promise<KnownViews> {
  if (typeViews(views, type.name).length > 0) return { views, takenPaths };
  const written = await materializeDefaultView({ ports, type, views, takenPaths });
  return { views: [...views, written.summary], takenPaths: [...takenPaths, written.path] };
}

/** Writes a new view carrying its own place, then the places the others moved to. */
async function writePlaced({
  ports,
  name,
  frontmatter,
  writes,
  takenPaths,
}: {
  ports: TypeViewPorts;
  name: string;
  frontmatter: Readonly<Record<string, unknown>>;
  writes: readonly ViewOrderWrite[];
} & KnownViews): Promise<void> {
  const path = viewPathFor(name);
  const own = writes.find((write) => write.path === path);
  await writeView({
    ports,
    name,
    frontmatter: own === undefined ? frontmatter : { ...frontmatter, [VIEW_ORDER_KEY]: own.order },
    takenPaths,
  });
  await writeOrders(
    ports,
    writes.filter((write) => write.path !== path),
  );
}

async function writeView({
  ports,
  name,
  heading = name,
  frontmatter,
  takenPaths,
}: {
  ports: TypeViewPorts;
  name: string;
  heading?: string;
  frontmatter: Readonly<Record<string, unknown>>;
  takenPaths: readonly string[];
}): Promise<WrittenView> {
  const path = await writeViewNote({ ...ports, takenPaths, name, heading, frontmatter });
  const summary = savedViewSummary(path, frontmatter);
  if (summary === null) throw new ViewRefusedError('That view could not be read back.');
  return { path, summary };
}

/** One write per file, in turn: a failure stops the rest rather than leaving them racing. */
async function writeOrders(ports: TypeViewPorts, writes: readonly ViewOrderWrite[]): Promise<void> {
  for (const { path, order } of writes) {
    await ports.writeProperties({ path, values: { [VIEW_ORDER_KEY]: order } });
  }
}

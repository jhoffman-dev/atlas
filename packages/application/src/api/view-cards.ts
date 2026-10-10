import {
  drawnLevels,
  groupColumnOptions,
  groupKeyOf,
  groupValueProperty,
  holdsTypeValues,
  isSavedView,
  NEW_NOTE_CONTENTS,
  parseQueryView,
  parseSavedView,
  parseSqlView,
  parseViewDisplay,
  splitFrontmatter,
  statusOf,
  VAULT_ROOT,
  type GroupedBy,
  type ObjectType,
  type RowGroup,
  type VaultPath,
  type ViewDisplay,
  type ViewQuery,
} from '@atlas/domain';
import { cardMoveChanges, movesToDone, type CardPlacement } from '../query/card-move.ts';
import { listVaultNotes } from '../vault/read-vault.ts';
import { ApiError } from './api-error.ts';
import type { ApiNote } from './contract.ts';
import {
  bodyObject,
  optionalModified,
  optionalString,
  requiredString,
  type Fields,
} from './fields.ts';
import { answerWithNote, checkIfModified, readNote } from './note-io.ts';
import { createNumberedNote, namedPath } from './notes-create.ts';
import { writeProperties } from './notes-write.ts';
import { isApiNotePath, isApiViewPath, notePathFrom, viewPathFromUrl } from './paths.ts';
import { boardGroupsOf, viewTypeOf } from './view-groups.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';
import { spelledAsVault } from './vault-spelling.ts';

/*
 * What a saved view's groups let James do to its notes (issue #6): drop a
 * card into another column and lane of a board, and add a note inside a
 * group — given that group's values, as "+ New" gives them. Both write only
 * the notes, in user space; the view itself, in `.atlas`, is never written.
 */

/** A saved view that lists one type: what a move on it or a note added to it is written by. */
interface TypedView {
  readonly path: VaultPath;
  readonly query: ViewQuery;
  readonly display: ViewDisplay;
  readonly type: ObjectType | null;
}

/**
 * Moves a card on a board to another column, another lane, or both, as a
 * drag does: one write, through the pane holding the note when one does,
 * with `cardMoveChanges` deciding whether that finishes the task and rolls a
 * repeating one forward. A group is one the board draws, matched as the board
 * keys its columns (`groupKeyOf`); the card's own is not written, as a drop
 * back into its own column writes nothing. A move that finishes the task must
 * say the `modified` it read the note at, so a retry of it is refused as
 * stale rather than finishing — and rolling forward — the task again.
 */
export async function moveCardRoute(request: VaultRequest): Promise<RouteResult> {
  const fields = bodyObject(request.body);
  const view = await typedViewOf(request);
  const { column, lane } = boardLevelsOf(view);
  const asked = askedGroups(fields, { first: column, second: lane, path: view.path });
  if (asked.group === undefined && asked.subGroup === undefined) {
    throw new ApiError('invalid', 'group or subGroup must say where the card goes');
  }
  const path = await spelledAsVault({
    fs: request.fs,
    asked: notePathFrom(requiredString(fields, 'note'), 'note'),
    accepts: isApiNotePath,
  });

  const { text, modified } = await readNote(request, path);
  const ifModified = optionalModified(fields, 'ifModified');
  checkIfModified(path, modified, ifModified);
  const properties = request.markdown.frontmatterProperties(splitFrontmatter(text).frontmatter);
  requireCardOf(view, { path, properties });

  const board = await boardGroupsOf(request, view);
  const [columnLevel, laneLevel] = board.levels;
  const move = {
    column: placementFor(view, {
      level: columnLevel,
      groups: board.columns,
      asked: asked.group,
      current: properties,
    }),
    lane: placementFor(view, {
      level: laneLevel,
      groups: board.lanes,
      asked: asked.subGroup,
      current: properties,
    }),
    status: statusOf(view.type),
    columnOptions: groupColumnOptions(view.type, column),
  };
  if (move.column === null && move.lane === null) {
    return withMoved(await answerWithNote(request, { path }), false);
  }
  if (ifModified === undefined && movesToDone(move)) throw retryUnsafe(path);
  await writeProperties(request, { path, expected: modified, values: cardMoveChanges(move) });
  return withMoved(await answerWithNote(request, { path }), true);
}

/**
 * Adds a note of the view's type inside one of its groups, given each
 * group's value typed by its property's kind — a number as a number, a tick
 * as `true`, "No value" as nothing — exactly as "+ New" in that group does.
 * It is made at the vault's root, named `New <type>` unless a name is asked
 * for, and numbered past any note already called that.
 */
export async function addViewNoteRoute(request: VaultRequest): Promise<RouteResult> {
  const fields = bodyObject(request.body);
  const view = await typedViewOf(request);
  const [first, second] = levelsOf(view);
  const asked = askedGroups(fields, {
    first: first?.key ?? null,
    second: second?.key ?? null,
    path: view.path,
  });
  const values = {
    ...groupValueProperty({ type: view.type, key: first?.key ?? null, value: asked.group }),
    ...groupValueProperty({ type: view.type, key: second?.key ?? null, value: asked.subGroup }),
  };
  const asName = optionalString(fields, 'name')?.trim() ?? '';
  const name = asName === '' ? `New ${view.query.type}` : asName;
  // Refused as POST /v1/notes refuses it: a name the API could not read back.
  namedPath(VAULT_ROOT, name);
  const contents =
    request.markdown.updateFrontmatter(null, { type: view.query.type, ...values }) +
    NEW_NOTE_CONTENTS;

  request.assertStillOpen();
  const path = await createNumberedNote({
    fs: request.fs,
    markdown: request.markdown,
    today: request.clock.today(),
    name,
    beside: null,
    folder: VAULT_ROOT,
    notePaths: await listVaultNotes({ fs: request.fs }),
    contents,
  });
  return answerWithNote(request, { path, status: 201 });
}

/** The saved view the URL names, refused when it is not one that lists a type. */
async function typedViewOf(request: VaultRequest): Promise<TypedView> {
  const path = await spelledAsVault({
    fs: request.fs,
    asked: viewPathFromUrl(request.pathParam),
    accepts: isApiViewPath,
  });
  const { text } = await readNote(request, path);
  const properties = request.markdown.frontmatterProperties(splitFrontmatter(text).frontmatter);
  if (!isSavedView(properties)) throw new ApiError('not_found', `${path} is not a view`);
  if (parseSqlView(properties) !== null || parseQueryView(properties) !== null) {
    throw new ApiError(
      'invalid',
      `${path} is a SQL or query view, whose notes are not moved or added from the view`,
    );
  }
  const query = parseSavedView(properties);
  if (query === null) throw new ApiError('invalid', `${path} does not say which type it lists`);
  return {
    path,
    query,
    display: parseViewDisplay(properties),
    type: await viewTypeOf(request, query.type),
  };
}

/** A board's column property and, when it has swimlanes, its lane property. */
function boardLevelsOf(view: TypedView): { column: string; lane: string | null } {
  if (view.display.layout !== 'board') {
    throw new ApiError(
      'invalid',
      `${view.path} is a ${view.display.layout}, not a board: set the note's properties instead`,
    );
  }
  const [column, lane] = levelsOf(view);
  if (column === undefined) {
    throw new ApiError('invalid', `${view.path} has no columns a card can move between`);
  }
  return { column: column.key, lane: lane?.key ?? null };
}

/**
 * The groups a request asked for: `undefined` when not asked, `null` for "No
 * value" — each only for a level the view draws.
 */
function askedGroups(
  fields: Fields,
  { first, second, path }: { first: string | null; second: string | null; path: VaultPath },
): { group: string | null | undefined; subGroup: string | null | undefined } {
  const group = groupValueIn(fields, 'group');
  const subGroup = groupValueIn(fields, 'subGroup');
  if (group !== undefined && first === null) {
    throw new ApiError('invalid', `${path} draws no groups (groupBy) to put a note in`);
  }
  if (subGroup !== undefined && second === null) {
    throw new ApiError('invalid', `${path} draws no sub-groups (subGroupBy) to put a note in`);
  }
  return { group, subGroup };
}

/** A group's value as asked: a string, or null (or '') for "No value". */
function groupValueIn(fields: Fields, field: string): string | null | undefined {
  const value = fields[field];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new ApiError('invalid', `${field} must be a group's value as a string, or null`);
  }
  return value.trim() === '' ? null : value;
}

/** The levels the view draws, before a relation's notes are read. */
function levelsOf(view: TypedView): GroupedBy[] {
  return drawnLevels({ display: view.display, type: view.type, sorts: view.query.sorts });
}

/**
 * A note the view lists, as a card of it. A view or a dashboard says `type:`
 * too, but there it names what it lists (`holdsTypeValues`), so it is never
 * a card — moving one would write a column into the view itself.
 */
function requireCardOf(
  view: TypedView,
  { path, properties }: { path: VaultPath; properties: Fields },
): void {
  if (!holdsTypeValues(properties)) {
    throw new ApiError(
      'invalid',
      `${path} is a view or dashboard, not a card: its type says what it lists`,
    );
  }
  if (properties['type'] !== view.query.type) {
    throw new ApiError('invalid', `${path} is not a ${view.query.type}, which ${view.path} lists`);
  }
}

/**
 * Where the card goes at one level: the group asked for, as the board spells
 * it — so ` done` is the done column and `[[atlas]]` the Atlas one — or null
 * when that level is not asked about or the card is in that group already.
 * A group the board does not draw is refused.
 */
function placementFor(
  view: TypedView,
  {
    level,
    groups,
    asked,
    current,
  }: {
    level: GroupedBy | undefined;
    groups: readonly RowGroup[];
    asked: string | null | undefined;
    current: Fields;
  },
): CardPlacement | null {
  if (level === undefined || asked === undefined) return null;
  const wanted = groupKeyOf(level, asked);
  if (groupKeyOf(level, current[level.key]) === wanted) return null;
  if (wanted === null) return { key: level.key, value: null, kind: level.kind };
  const group = groups.find(
    (candidate) => candidate.value !== null && groupKeyOf(level, candidate.value) === wanted,
  );
  if (group === undefined) throw notAGroup(view, { asked, level, groups });
  return { key: level.key, value: group.value, kind: level.kind };
}

/** How many of a board's groups a refusal names before it stops. */
const NAMED_GROUPS = 20;

function notAGroup(
  view: TypedView,
  { asked, level, groups }: { asked: string | null; level: GroupedBy; groups: readonly RowGroup[] },
): ApiError {
  const values = groups.flatMap((group) => (group.value === null ? [] : [group.value]));
  const named = values.slice(0, NAMED_GROUPS).map((value) => JSON.stringify(value));
  const more = values.length > NAMED_GROUPS ? ', …' : '';
  return new ApiError(
    'invalid',
    `${JSON.stringify(asked)} is not one of ${view.path}'s ${level.key} groups ` +
      `(${named.join(', ')}${more}), nor null for "No value"`,
  );
}

/** A finishing move sent without `ifModified`: a retry of it would finish the task again. */
function retryUnsafe(path: VaultPath): ApiError {
  return new ApiError(
    'invalid',
    `Moving ${path} there finishes it, rolling a repeating task forward, so the move needs ` +
      "ifModified (the note's modified as you read it): a retried move is then refused as " +
      'stale instead of finishing it twice',
  );
}

/** The note as it now is, and whether this move wrote it. */
function withMoved(answer: { body: { note: ApiNote } }, moved: boolean): RouteResult {
  return { status: 200, body: { note: answer.body.note, moved } };
}

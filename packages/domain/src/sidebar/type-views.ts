/**
 * A type owns its views (issue #11, ADR-0023): which saved views belong to a
 * type, the order its tabs read in, which one a click on the type lands on,
 * and what a type with no views shows instead.
 *
 * A view belongs to the type its `type:` names. Its place among the type's
 * tabs is an `order:` number in its own frontmatter, so a reorder is an
 * ordinary property write and a view without one — every view written before
 * this, or by hand — still has a place: after the placed ones, in the order
 * the tabs always used.
 */

import { layoutLabel, usableViewName, viewNameProblem, viewPathFor } from '../query/new-view.ts';
import type { ViewLayout } from '../query/saved-view.ts';
import type { ObjectType } from '../types/property-def.ts';
import { compareNames } from '../vault/name-order.ts';
import type { VaultPath } from '../vault/vault-path.ts';

/** The frontmatter key a view keeps its place among its type's tabs under. */
export const VIEW_ORDER_KEY = 'order';

/** What ordering a type's views needs to know about each. */
export interface PlacedView {
  readonly path: VaultPath;
  readonly title: string;
  readonly type: string;
  readonly layout: ViewLayout;
  /** Its `order:`, or null when it was never placed. */
  readonly order: number | null;
}

/** A number as a person writes one by hand: `2`, `-1`, `1.5`, `.5` — never `0x10` or `1e3`. */
const PLAIN_DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

/**
 * A view's `order:`, or null when it has none that reads as a number. A
 * hand-written `order: "2"` counts; `order: soon` is no order at all, which
 * costs the view its place rather than its tab. Text counts only as a plain
 * decimal: `Number()` would read "0x10" as 16, a place nobody wrote.
 */
export function viewOrderOf(frontmatter: Readonly<Record<string, unknown>>): number | null {
  const raw = frontmatter[VIEW_ORDER_KEY];
  const text = typeof raw === 'string' ? raw.trim() : '';
  const value = typeof raw === 'number' ? raw : PLAIN_DECIMAL.test(text) ? Number(text) : NaN;
  return Number.isFinite(value) ? value : null;
}

/**
 * The order unplaced tabs read in: the shape of the work first — a board,
 * then the table under it — then the lists, then time. Two of a layout go by
 * name. This was the only order before tabs could be moved, so a type nobody
 * has reordered looks exactly as it did.
 */
const LAYOUT_ORDER: readonly ViewLayout[] = [
  'board',
  'table',
  'list',
  'gallery',
  'feed',
  'calendar',
  'timeline',
];

function byLayoutThenName(left: PlacedView, right: PlacedView): number {
  return (
    LAYOUT_ORDER.indexOf(left.layout) - LAYOUT_ORDER.indexOf(right.layout) ||
    compareNames(left.title, right.title) ||
    compareNames(left.path, right.path)
  );
}

/** Placed views first, by their order; then the unplaced, as they always read. */
export function compareViewPlaces(left: PlacedView, right: PlacedView): number {
  if (left.order !== null && right.order !== null) {
    return left.order - right.order || byLayoutThenName(left, right);
  }
  if (left.order !== null) return -1;
  if (right.order !== null) return 1;
  return byLayoutThenName(left, right);
}

/** The views a type owns, in the order its tabs read; one per path. */
export function typeViews<View extends PlacedView>(
  views: readonly View[],
  typeName: string,
): View[] {
  const byPath = new Map<string, View>();
  for (const view of views) if (view.type === typeName) byPath.set(view.path, view);
  return [...byPath.values()].sort(compareViewPlaces);
}

/**
 * Which of a type's views a click on the type opens: the one last open on
 * this machine while it is still the type's, else the first tab. Null when the
 * type has no views, which is when its default table is shown instead.
 */
export function landingView<View extends PlacedView>({
  views,
  typeName,
  remembered,
}: {
  views: readonly View[];
  typeName: string;
  remembered: string | null;
}): View | null {
  const owned = typeViews(views, typeName);
  return owned.find((view) => view.path === remembered) ?? owned[0] ?? null;
}

/** One `order:` to write so the tabs read as asked. */
export interface ViewOrderWrite {
  readonly path: VaultPath;
  readonly order: number;
}

/**
 * The writes that make views read in `sequence`, touching as few files as it
 * can: an order already greater than the one before it is kept, and anything
 * else — unplaced, or now out of step — is given the next whole number. So a
 * tab added at the end writes one file. Where the numbers have no next one
 * (past 2^53 a float cannot count by one), every view is numbered afresh from
 * one instead.
 */
export function orderWrites(sequence: readonly PlacedView[]): ViewOrderWrite[] {
  const writes: ViewOrderWrite[] = [];
  let last = Number.NEGATIVE_INFINITY;
  for (const view of sequence) {
    if (view.order !== null && view.order > last) {
      last = view.order;
      continue;
    }
    const order = last === Number.NEGATIVE_INFINITY ? 1 : Math.floor(last) + 1;
    if (order <= last) return renumbered(sequence);
    writes.push({ path: view.path, order });
    last = order;
  }
  return writes;
}

/** Every view numbered from one, writing only those not already at their number. */
function renumbered(sequence: readonly PlacedView[]): ViewOrderWrite[] {
  return sequence.flatMap((view, at) =>
    view.order === at + 1 ? [] : [{ path: view.path, order: at + 1 }],
  );
}

/**
 * An order that puts a view between `before` and `after` without touching
 * either: one less than the first, one more than the last placed, else a whole
 * number between them, else halfway. Null when there is none — it lands after
 * a view nobody placed, its neighbours share an order, or the numbers are too
 * large to step past.
 */
function orderBetween(
  before: PlacedView | undefined,
  after: PlacedView | undefined,
): number | null {
  if (before !== undefined && before.order === null) return null;
  const low = before?.order ?? null;
  // A view nobody placed reads after every placed one, so it bounds nothing.
  const high = after?.order ?? null;
  const order = low === null ? (high === null ? 1 : Math.ceil(high) - 1) : stepPast(low, high);
  const fits = (low === null || order > low) && (high === null || order < high);
  return fits ? order : null;
}

/** The next whole number past `low` when it is still short of `high`, else halfway. */
function stepPast(low: number, high: number | null): number {
  const whole = Math.floor(low) + 1;
  if (high === null || (whole > low && whole < high)) return whole;
  // Halved first, so two orders near the largest float do not add up to infinity.
  return low / 2 + high / 2;
}

/**
 * The writes that move one of a type's tabs to position `to`: the moved view
 * alone wherever it can be (`orderBetween`), and only otherwise the views
 * before it renumbered. Nothing for a move that goes nowhere, names a view the
 * type does not own, or points past either end.
 */
export function movedViewOrder({
  views,
  typeName,
  path,
  to,
}: {
  views: readonly PlacedView[];
  typeName: string;
  path: string;
  to: number;
}): ViewOrderWrite[] {
  const owned = typeViews(views, typeName);
  const from = owned.findIndex((view) => view.path === path);
  if (from === -1 || !Number.isInteger(to) || to < 0 || to >= owned.length || to === from) {
    return [];
  }
  const sequence = [...owned];
  const [moved] = sequence.splice(from, 1);
  if (moved === undefined) return [];
  sequence.splice(to, 0, moved);
  const order = orderBetween(sequence[to - 1], sequence[to + 1]);
  if (order !== null) return [{ path: moved.path, order }];
  // Placed views read before unplaced ones, so the unplaced after both the
  // last placed view and the moved one keep their place unwritten.
  const lastPlaced = sequence.findLastIndex((view) => view.order !== null);
  return orderWrites(sequence.slice(0, Math.max(lastPlaced, to) + 1));
}

/**
 * The writes that place a view not yet among the type's tabs — a new one, or
 * a copy — at position `at` (clamped to the ends). The new view's own order is
 * among them, so it can be written into the file as it is made.
 */
export function insertedViewOrder({
  views,
  typeName,
  added,
  at,
}: {
  views: readonly PlacedView[];
  typeName: string;
  added: PlacedView;
  at: number;
}): ViewOrderWrite[] {
  const sequence: PlacedView[] = typeViews(views, typeName).filter(
    (view) => view.path !== added.path,
  );
  const place = Math.min(Math.max(Math.trunc(at), 0), sequence.length);
  sequence.splice(place, 0, { ...added, order: null });
  return orderWrites(sequence);
}

/**
 * The tab to land on once `path` is deleted: the one after it, else the one
 * before; null when it was the type's last view.
 */
export function viewAfterRemoval({
  views,
  typeName,
  path,
}: {
  views: readonly PlacedView[];
  typeName: string;
  path: string;
}): VaultPath | null {
  const owned = typeViews(views, typeName);
  const at = owned.findIndex((view) => view.path === path);
  if (at === -1) return null;
  return (owned[at + 1] ?? owned[at - 1])?.path ?? null;
}

/**
 * A file name no view has yet: `base` as a file can be called
 * (`usableViewName`), else `base 2`, `base 3`… Names collide without regard
 * to case, as the file system would. The search is bounded: each taken path
 * can block one candidate at most, so one more than there are always finds one.
 */
export function uniqueViewName(base: string, takenPaths: readonly string[]): string {
  for (let suffix = 1; suffix <= takenPaths.length + 1; suffix += 1) {
    const ending = suffix === 1 ? '' : ` ${suffix}`;
    const name = `${usableViewName(base, ending)}${ending}`;
    if (viewNameProblem(name, takenPaths) === null) return name;
  }
  throw new Error(`No free view name for ${JSON.stringify(base)}`);
}

/** A view to be written: its file name, and the `title:` it needs, or null when the file name says it. */
export interface ViewNaming {
  readonly fileName: string;
  readonly title: string | null;
}

/**
 * A view renamed to `name` as it is first written — a type's default table
 * (ADR-0023). It is called exactly what was typed, as a written tab is when
 * renamed, and its file takes the nearest name a disk holds.
 */
export function viewNamedAs(name: string, takenPaths: readonly string[]): ViewNaming {
  const fileName = uniqueViewName(name, takenPaths);
  const title = name.trim();
  return { fileName, title: fileName === title ? null : title };
}

/**
 * Every path a new view's file cannot be written to: each entry already in
 * the views folder — a view, one lifted to Today or Inbox, or a note that is
 * no view at all — and every view wherever it is kept. The app's tabs, its
 * writes and the API all name a new view against this, so the name a tab
 * shows is the file it is written as.
 */
export function takenViewPaths({
  listed,
  views,
}: {
  listed: readonly string[];
  views: readonly { readonly path: string }[];
}): string[] {
  return [...new Set([...listed, ...views.map((view) => view.path)])];
}

/**
 * A copy of the view titled `title`: "Board copy", then "Board copy 2", its
 * file saying so. A title a file name cannot hold — "Q1/Q2", or one longer
 * than a disk allows — is kept as the copy's title, beside a file called the
 * nearest it can be.
 */
export function viewCopyNamed(title: string, takenPaths: readonly string[]): ViewNaming {
  const wanted = `${title.trim()} copy`;
  const fileName = uniqueViewName(wanted, takenPaths);
  const numbering = fileName.slice(wanted.length);
  const says = fileName.startsWith(wanted) && /^( \d+)?$/.test(numbering);
  return { fileName, title: says ? null : wanted };
}

/**
 * What a view added from a type's tabs is called: "Task board", "Task board
 * 2". Nobody is asked for a file name; the tab can be renamed afterwards. A
 * type label a file name cannot hold falls back to the type's own name, which
 * the type rules keep plain.
 */
export function newTypeViewName({
  type,
  layout,
  takenPaths,
}: {
  type: Pick<ObjectType, 'name' | 'label'>;
  layout: ViewLayout;
  takenPaths: readonly string[];
}): string {
  const kind = layoutLabel(layout).toLowerCase();
  const labelled = `${type.label} ${kind}`;
  const usable = viewNameProblem(labelled, []) === null ? labelled : `${type.name} ${kind}`;
  return uniqueViewName(usable, takenPaths);
}

/** The file a copy of a view is written to: "Board copy", then "Board copy 2". */
export function duplicateViewName(title: string, takenPaths: readonly string[]): string {
  return viewCopyNamed(title, takenPaths).fileName;
}

/** Why a view cannot be renamed to this, or null. Only blank is refused: the name is a title. */
export function viewTitleProblem(name: string): string | null {
  return name.trim() === '' ? 'Name the view.' : null;
}

/**
 * The tab a type with no views shows: its default table, not yet a file. It
 * wears the name and the path it will be written under the moment the tabs
 * are changed — a view added, it renamed or copied — so what is shown is what
 * gets saved.
 */
export function defaultViewTab({
  type,
  takenPaths,
}: {
  type: Pick<ObjectType, 'name' | 'label'>;
  takenPaths: readonly string[];
}): {
  path: VaultPath;
  title: string;
  icon: 'table';
  selected: true;
  virtual: true;
  movable: false;
  deletable: false;
} {
  const title = newTypeViewName({ type, layout: 'table', takenPaths });
  return {
    path: viewPathFor(title),
    title,
    icon: 'table',
    selected: true,
    virtual: true,
    // Not a file yet: there is nothing to move it among, and nothing to delete.
    movable: false,
    deletable: false,
  };
}

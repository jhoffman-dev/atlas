import {
  buildTagTree,
  findTagNode,
  formatTag,
  isTagName,
  tagKey,
  tagNameFromInput,
  type TagRename,
  type TagSort,
  type TagTreeNode,
  type VaultPath,
} from '@atlas/domain';
import {
  loadTagCountsWhere,
  loadTaggedNotes,
  TagMergeError,
  TagRenameError,
  type TaggedNote,
  type TagRenamePlan,
} from '../tags/index.ts';
import type { LinkUpdatePanes } from '../vault/index.ts';
import { ApiError } from './api-error.ts';
import type { ApiTag, ApiTaggedNote, ApiTagRenamePreview } from './contract.ts';
import { pageAfter } from './cursor.ts';
import { bodyObject, countOf, optionalBoolean, requiredString } from './fields.ts';
import { decodeSegment, isApiNotePath } from './paths.ts';
import type { OpenNotes } from './ports.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';

/*
 * Tags through the local API: the tree the tags page shows, the notes using a
 * tag, and renaming one — each by the use-case the page runs. A tag is named
 * however it is cased, as the vault counts it, and answered as the vault
 * spells it. Tags are counted in the notes the API reads, as the notes list
 * and a rename's writes are: a tag only a template uses is not one here.
 */

const PAGE = { fallback: 100, max: 500 };
const SORTS: readonly TagSort[] = ['name', 'frequency'];
const OUTSIDE_USER_SPACE = 'in .atlas or a hidden folder, which the API cannot write';

/** `GET /v1/tags`: every tag, nested, sorted by name or by how often it is used. */
export async function tagsRoute(request: VaultRequest): Promise<RouteResult> {
  const sort = sortOf(request.query['sort']);
  const counts = await userSpaceCounts(request);
  request.assertStillOpen();
  return { status: 200, body: { tags: buildTagTree(counts, sort).map(toApiTag) } };
}

/**
 * `GET /v1/tags/{tag}/notes`: a page of the notes using the tag or one nested
 * under it, in path order, continued from the last path as `/v1/notes` is.
 */
export async function taggedNotesRoute(request: VaultRequest): Promise<RouteResult> {
  const { query } = request;
  const limit = countOf(query['limit'], { field: 'limit', ...PAGE });
  const tag = await tagOf(request);

  const tagged = (await loadTaggedNotes({ index: request.index, key: tag.key })).filter((note) =>
    isApiNotePath(note.path),
  );
  request.assertStillOpen();

  const pathOf = (note: TaggedNote) => note.path;
  const { page, next } = pageAfter({ items: tagged, pathOf, cursor: query['cursor'], limit });
  return { status: 200, body: { tag: toApiTag(tag), notes: page.map(toApiTaggedNote), next } };
}

/**
 * `POST /v1/tags/{tag}/rename`: what renaming the tag would change, and — unless
 * `dryRun` — the rename itself, note by note, as the tags page makes it. Only
 * notes in user space are written; a note being typed in is left alone. The
 * rename waits its turn behind any other in the vault, and is refused as a
 * merge if, by the time it writes, the new name has come into use.
 */
export async function renameTagRoute(request: VaultRequest): Promise<RouteResult> {
  const fields = bodyObject(request.body);
  const to = tagNameFromInput(requiredString(fields, 'to'));
  const dryRun = optionalBoolean(fields, 'dryRun') ?? false;
  const merge = optionalBoolean(fields, 'merge') ?? false;
  const from = (await tagOf(request)).name;

  const { plan, skipped } = await userSpacePlan(request, { from, to });
  const rename = toPreview(plan, skipped);
  if (dryRun) return { status: 200, body: { rename } };
  if (plan.mergesInto !== null && !merge) throw unconfirmedMerge(plan.rename, plan.mergesInto);

  const report = await renameInTurn(request, { plan, merge });
  request.assertStillOpen();
  return { status: 200, body: { rename, report } };
}

/** The tag the URL names, found however it is cased, or `not_found` when no note uses it. */
async function tagOf(request: VaultRequest): Promise<TagTreeNode> {
  const asked = tagNameFromInput(decodeSegment(request.tagParam, 'tag'));
  if (!isTagName(asked)) {
    throw new ApiError('invalid', `tag ${JSON.stringify(asked)} is not a tag's name`);
  }
  const counts = await userSpaceCounts(request);
  request.assertStillOpen();
  const node = findTagNode(buildTagTree(counts, 'name'), tagKey(asked));
  if (node === null) throw new ApiError('not_found', `No note uses ${formatTag(asked)}`);
  return node;
}

/** Every tag the notes in user space use, with how often. */
function userSpaceCounts(request: VaultRequest) {
  return loadTagCountsWhere({ index: request.index, includes: isApiNotePath });
}

/**
 * The rename's plan, cut to the notes the API may write. One in `.atlas` or a
 * hidden folder — a template's tags, say — is named as skipped, not rewritten.
 */
async function userSpacePlan(
  request: VaultRequest,
  rename: TagRename,
): Promise<{ plan: TagRenamePlan; skipped: { path: VaultPath; reason: string }[] }> {
  const whole = await planOf(request, rename);
  request.assertStillOpen();
  const notes = whole.notes.filter((note) => isApiNotePath(note.path));
  const skipped = [
    ...whole.notes
      .filter((note) => !isApiNotePath(note.path))
      .map((note) => ({ path: note.path, reason: OUTSIDE_USER_SPACE })),
    ...whole.refused.filter((note) => isApiNotePath(note.path)),
  ];
  const total = notes.reduce((sum, note) => sum + note.count, 0);
  return { plan: { ...whole, notes, total }, skipped };
}

async function planOf(request: VaultRequest, rename: TagRename): Promise<TagRenamePlan> {
  try {
    const { index, fs, markdown } = request;
    return await request.tagRenames.plan({ index, fs, markdown, rename });
  } catch (error) {
    if (error instanceof TagRenameError) throw new ApiError('invalid', error.message);
    throw error;
  }
}

async function renameInTurn(
  request: VaultRequest,
  { plan, merge }: { plan: TagRenamePlan; merge: boolean },
) {
  const { index, fs, markdown } = request;
  const openNotes = typingLeftAlone(request.openNotes);
  try {
    return await request.tagRenames.rename({ index, fs, markdown, openNotes, plan, merge });
  } catch (error) {
    if (error instanceof TagMergeError) throw unconfirmedMerge(plan.rename, error.into);
    throw error;
  }
}

/**
 * The panes, as a rename from outside the app may use them. The tags page
 * saves a pane's unsaved typing before renaming in it; a request from another
 * tool must not save what the person is still typing, just as it may not write
 * a body under it (ADR-0016). So nothing is flushed, and the rename reports
 * such a note as having unsaved changes and leaves it alone.
 */
function typingLeftAlone(openNotes: OpenNotes): LinkUpdatePanes {
  return {
    state: (path) => openNotes.state(path),
    flush: () => Promise.resolve(),
    reload: (path) => openNotes.reload(path),
  };
}

function unconfirmedMerge(rename: TagRename, into: string): ApiError {
  return new ApiError(
    'exists',
    `${formatTag(into)} is in use already, so ${formatTag(rename.from)} would merge into it, which ` +
      'renaming back cannot undo. Nothing was written; send merge: true to rename anyway',
  );
}

function sortOf(raw: string | undefined): TagSort {
  if (raw === undefined) return 'name';
  const sort = SORTS.find((candidate) => candidate === raw);
  if (sort === undefined) throw new ApiError('invalid', 'sort must be name or frequency');
  return sort;
}

function toApiTag(node: TagTreeNode): ApiTag {
  const { name, label, count, total } = node;
  return { name, label, count, total, children: node.children.map(toApiTag) };
}

function toApiTaggedNote(note: TaggedNote): ApiTaggedNote {
  return { path: note.path, title: note.title, uses: note.count };
}

function toPreview(
  plan: TagRenamePlan,
  skipped: readonly { path: VaultPath; reason: string }[],
): ApiTagRenamePreview {
  return {
    from: plan.rename.from,
    to: plan.rename.to,
    files: plan.notes.length,
    uses: plan.total,
    mergesInto: plan.mergesInto,
    notes: plan.notes.map(toApiTaggedNote),
    skipped,
  };
}

import { vaultSpellingOf, type DuplicatePair, type VaultPath } from '@atlas/domain';
import {
  applyPeopleMerge,
  loadPossibleDuplicates,
  PeopleMergeChangedError,
  PeopleMergeRefusedError,
  previewPeopleMerge,
  type MergePanes,
  type PeopleMergePreview,
  type PeopleMergeReport,
} from '../people/index.ts';
import { listVaultNotes } from '../vault/read-vault.ts';
import { ApiError, messageWithoutPaths } from './api-error.ts';
import { archivePorts } from './archive.ts';
import type { ApiDuplicatePair, ApiPeopleMergePreview, ApiPeopleMergeReport } from './contract.ts';
import { bodyObject, optionalArray, optionalBoolean, requiredString } from './fields.ts';
import { isApiNotePath, notePathFrom } from './paths.ts';
import type { MovingNotes } from './ports.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';

/*
 * People through the local API (#464): the pairs who may be one person, and
 * merging them — the use-cases the People page runs, previewed unless the
 * caller confirms, as a tag rename is.
 */

/** How many people one merge may take: each is a body, a Trash move and every link to them. */
const MAX_MERGED = 20;
const OUTSIDE_USER_SPACE = 'in .atlas or a hidden folder, which the API cannot write';

/** `GET /v1/people/duplicates`: the possible duplicate pairs, among the notes the API reads. */
export async function duplicatesRoute(request: VaultRequest): Promise<RouteResult> {
  const pairs = await loadPossibleDuplicates(request).catch((error: unknown) => {
    throw new ApiError('query_failed', messageWithoutPaths(error));
  });
  request.assertStillOpen();
  const reachable = pairs.filter(
    (pair) => isApiNotePath(pair.left.path) && isApiNotePath(pair.right.path),
  );
  return { status: 200, body: { pairs: reachable.map(toApiPair) } };
}

/**
 * `POST /v1/people/merge`: what merging `merge` into `keep` would do, and —
 * with `confirm` — the merge itself, worked out afresh and written file by
 * file. A note being typed in refuses it: the API never saves someone's
 * typing for them (ADR-0016). A note changed between the preview and the
 * writes refuses it too, with nothing written.
 */
export async function mergePeopleRoute(request: VaultRequest): Promise<RouteResult> {
  const fields = bodyObject(request.body);
  const confirm = optionalBoolean(fields, 'confirm') ?? false;
  const notePaths = await listVaultNotes({ fs: request.fs });
  const keep = noteNamed(requiredString(fields, 'keep'), 'keep', notePaths);
  const merge = mergedPeople(fields, notePaths);

  const ports = mergePorts(request);
  const whole = await previewPeopleMerge({ ports, request: { keep, merge }, notePaths });
  request.assertStillOpen();
  const { preview, skipped } = userSpaceOnly(whole);
  const shown = toApiPreview(preview, skipped);
  if (!confirm) return { status: 200, body: { merge: shown } };
  if (preview.refusal !== null) throw new ApiError('invalid', preview.refusal);

  const report = await applyPeopleMerge({ ports, preview }).catch((error: unknown) => {
    if (error instanceof PeopleMergeChangedError) throw new ApiError('conflict', error.message);
    if (error instanceof PeopleMergeRefusedError) throw new ApiError('invalid', error.message);
    throw error;
  });
  return { status: 200, body: { merge: shown, report: toApiReport(report) } };
}

function mergedPeople(
  fields: Record<string, unknown>,
  notePaths: readonly VaultPath[],
): VaultPath[] {
  const listed = optionalArray(fields, 'merge');
  if (listed === undefined || listed.length === 0 || listed.length > MAX_MERGED) {
    throw new ApiError('invalid', `merge must list 1 to ${MAX_MERGED} note paths`);
  }
  return listed.map((raw, at) => {
    if (typeof raw !== 'string') throw new ApiError('invalid', `merge[${at}] must be a string`);
    return noteNamed(raw, `merge[${at}]`, notePaths);
  });
}

/** The note a body names, spelt as the vault spells it, or `not_found`. */
function noteNamed(raw: string, field: string, notePaths: readonly VaultPath[]): VaultPath {
  const path = notePathFrom(raw, field);
  const found = vaultSpellingOf(path, notePaths);
  if (found === null) throw new ApiError('not_found', `${field}: there is no note at ${path}`);
  return found;
}

/** What a merge reaches, bound to this request's vault as an archive batch's ports are. */
function mergePorts(request: VaultRequest) {
  const { fs, index, markdown, editors } = archivePorts(request);
  return { fs, index, markdown, editors: typingLeftAlone(editors) };
}

/**
 * The panes, as a merge from outside the app may use them: nothing is
 * flushed, so a note being typed in refuses the merge rather than having its
 * typing saved for it.
 */
function typingLeftAlone(panes: MovingNotes): MergePanes {
  return {
    state: (path) => panes.state(path),
    flush: () => Promise.resolve(),
    abandon: (paths) => panes.abandon(paths),
    reload: (path) => panes.reload(path),
  };
}

/** The preview cut to the notes the API may write; a note outside user space is named as skipped. */
function userSpaceOnly(preview: PeopleMergePreview): {
  preview: PeopleMergePreview;
  skipped: { path: VaultPath; reason: string }[];
} {
  const writes = preview.writes.filter((write) => isApiNotePath(write.path));
  const skipped = preview.writes
    .filter((write) => !isApiNotePath(write.path))
    .map((write) => ({ path: write.path, reason: OUTSIDE_USER_SPACE }));
  const links = writes.reduce((sum, write) => sum + write.links, 0);
  return { preview: { ...preview, writes, links }, skipped };
}

function toApiPair(pair: DuplicatePair): ApiDuplicatePair {
  return {
    left: { path: pair.left.path, name: pair.left.name },
    right: { path: pair.right.path, name: pair.right.name },
    reasons: pair.reasons,
  };
}

function toApiPreview(
  preview: PeopleMergePreview,
  skipped: readonly { path: VaultPath; reason: string }[],
): ApiPeopleMergePreview {
  return {
    keep: preview.keep,
    merge: preview.merge,
    refusal: preview.refusal,
    notes: preview.writes.map(({ path, links }) => ({ path, links })),
    links: preview.links,
    conflicts: preview.plan?.conflicts ?? [],
    aliasesAdded: preview.plan?.aliasesAdded ?? [],
    emailsAdded: preview.plan?.emailsAdded ?? [],
    appended: (preview.plan?.appended ?? []).map(({ from, heading }) => ({ from, heading })),
    skipped,
  };
}

function toApiReport(report: PeopleMergeReport): ApiPeopleMergeReport {
  return {
    written: report.written,
    notWritten: report.notWritten,
    trashed: report.trashed,
    notTrashed: report.notTrashed,
    failures: report.failures.map((failure) => ({
      ...failure,
      reason: messageWithoutPaths(new Error(failure.reason)),
    })),
    links: report.links,
  };
}

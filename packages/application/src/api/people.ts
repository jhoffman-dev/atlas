import { vaultSpellingOf, type DuplicatePair, type VaultPath } from '@dfai/domain';
import {
  applyPeopleMerge,
  loadPossibleDuplicates,
  PeopleMergeChangedError,
  PeopleMergeRefusedError,
  previewPeopleMerge,
  type PeopleMergePreview,
  type PeopleMergeReport,
} from '../people/index.ts';
import { listVaultNotes } from '../vault/read-vault.ts';
import { ApiError, messageWithoutPaths } from './api-error.ts';
import { archivePorts } from './archive.ts';
import type { ApiDuplicatePair, ApiPeopleMergePreview, ApiPeopleMergeReport } from './contract.ts';
import {
  bodyObject,
  optionalArray,
  optionalBoolean,
  optionalString,
  requiredString,
} from './fields.ts';
import { isApiNotePath, notePathFrom } from './paths.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';

/*
 * People through the local API (#464): the pairs who may be one person, and
 * merging them — the use-cases the People page runs, previewed unless the
 * caller confirms with the version of the preview it was shown, as a tag
 * rename is previewed. Templates linking to a merged person are rewritten as
 * the app rewrites them; any other note of DFAI's own refuses the merge.
 */

/** How many people one merge may take: each is a body, a Trash move and every link to them. */
const MAX_MERGED = 20;
/** Why a confirm is not made: what it would merge is not what the caller was shown. */
const NOT_AS_SHOWN =
  'The vault no longer gives the preview this confirm was sent with, so nothing was merged. Preview again and confirm that.';

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
 * file. Typing in the app's panes is saved first, as the app's own merge
 * saves it; typing that cannot be saved refuses it with `conflict` (#467). A note changed between the preview and the
 * writes refuses it too, with nothing written.
 */
export async function mergePeopleRoute(request: VaultRequest): Promise<RouteResult> {
  const fields = bodyObject(request.body);
  const confirm = optionalBoolean(fields, 'confirm') ?? false;
  const version = optionalString(fields, 'version');
  const notePaths = await listVaultNotes({ fs: request.fs });
  const keep = noteNamed(requiredString(fields, 'keep'), 'keep', notePaths);
  const merge = mergedPeople(fields, notePaths);

  const ports = mergePorts(request);
  const preview = await previewPeopleMerge({ ports, request: { keep, merge }, notePaths });
  request.assertStillOpen();
  const shown = toApiPreview(preview);
  if (!confirm) return { status: 200, body: { merge: shown } };
  if (preview.refusal !== null) {
    throw new ApiError(preview.blockedByTyping ? 'conflict' : 'invalid', preview.refusal);
  }
  if (version !== preview.version) throw new ApiError('conflict', NOT_AS_SHOWN);

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

/**
 * What a merge reaches, bound to this request's vault as an archive batch's
 * ports are: the app's panes — typing in any of them is saved first, since it
 * may hold a link to a merged person — and its index, brought up to the files
 * before it is asked who links to them.
 */
function mergePorts(request: VaultRequest) {
  return { ...archivePorts(request), refreshIndex: request.refreshIndex };
}

function toApiPair(pair: DuplicatePair): ApiDuplicatePair {
  return {
    left: { path: pair.left.path, name: pair.left.name },
    right: { path: pair.right.path, name: pair.right.name },
    reasons: pair.reasons,
  };
}

function toApiPreview(preview: PeopleMergePreview): ApiPeopleMergePreview {
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
    version: preview.version,
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

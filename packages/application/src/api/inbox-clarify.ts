import {
  createVaultPath,
  InvalidVaultPathError,
  type Clarification,
  type VaultPath,
} from '@dfai/domain';
import { clarifyInboxItem, ClarifyRefusedError } from '../inbox/clarify-inbox-item.ts';
import { NoteChangedError } from '../notes/note-changed-error.ts';
import { UnsavedTypingError } from '../vault/update-links.ts';
import { listVaultNotes } from '../vault/read-vault.ts';
import { ApiError, messageWithoutPaths } from './api-error.ts';
import { archivePorts } from './archive.ts';
import type { ApiClarifyOutcome } from './contract.ts';
import { bodyObject, optionalArray, optionalBoolean, optionalString } from './fields.ts';
import { isApiNotePath } from './paths.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';

type Fields = ReturnType<typeof bodyObject>;

/**
 * Clarifies one note waiting in the Inbox, as a row of the Inbox page does
 * (#112): status, who it waits on, defer, due and contexts are written in one
 * byte-preserving save held to the task rules, and a note in the `Inbox`
 * folder given a project is then filed under it. Waiting never needs anyone
 * to wait on (#202). Anything refused — a status the vault does not declare,
 * a project that is not one — is `invalid` and nothing is written. Never saves someone's typing (ADR-0016): a note
 * open in DFAI with unsaved edits is `unsaved_in_app`, and one that changed
 * on disk between being read and written is `conflict`. The route decides on
 * any task the API reaches, not only one the Inbox lists — an agent may move a
 * task on from anywhere — but never an archived one.
 */
export async function clarifyInboxRoute(request: VaultRequest): Promise<RouteResult> {
  const fields = bodyObject(request.body);
  const path = notePath(fields, 'path');
  if (path === undefined || path === null) throw new ApiError('invalid', 'path must be a string');
  const clarification = clarificationOf(fields);
  const notePaths = await listVaultNotes({ fs: request.fs });
  try {
    const outcome = await clarifyInboxItem({
      ports: archivePorts(request),
      path,
      clarification,
      notePaths,
      today: request.clock.today(),
      unsavedTyping: 'leave',
    });
    const body: ApiClarifyOutcome = {
      path: outcome.path,
      movedFrom: outcome.movedFrom,
      failed: outcome.failed.map(({ path: at, reason, unsavedInApp }) => ({
        path: at,
        reason: messageWithoutPaths(reason),
        ...(unsavedInApp === true && { code: 'unsaved_in_app' as const }),
      })),
      linksUpdated: outcome.linksUpdated,
    };
    return { status: 200, body };
  } catch (error) {
    if (error instanceof ClarifyRefusedError) throw new ApiError('invalid', error.message);
    if (error instanceof NoteChangedError) {
      throw new ApiError(
        'conflict',
        `${path} changed while it was being clarified; nothing was written`,
      );
    }
    if (error instanceof UnsavedTypingError) {
      throw new ApiError('unsaved_in_app', `${path} is open in DFAI with unsaved edits`);
    }
    throw error;
  }
}

function clarificationOf(fields: Fields): Clarification {
  const status = optionalString(fields, 'status');
  const project = notePath(fields, 'project');
  if (project === null) throw new ApiError('invalid', 'project must be a string');
  const waitingOn = notePath(fields, 'waitingOn');
  const defer = dayOrNull(fields, 'defer');
  const due = dayOrNull(fields, 'due');
  const contexts = optionalArray(fields, 'contexts');
  if (contexts !== undefined && !contexts.every((context) => typeof context === 'string')) {
    throw new ApiError('invalid', 'contexts must be a list of strings');
  }
  const asTask = optionalBoolean(fields, 'asTask');
  return {
    ...(status !== undefined && { status }),
    ...(project !== undefined && { project }),
    ...(waitingOn !== undefined && { waitingOn }),
    ...(defer !== undefined && { defer }),
    ...(due !== undefined && { due }),
    ...(contexts !== undefined && { contexts: contexts as readonly string[] }),
    ...(asTask !== undefined && { asTask }),
  };
}

/** A field that is a day, or null to take it away; undefined when the body leaves it out. */
function dayOrNull(fields: Fields, field: string): string | null | undefined {
  return fields[field] === null ? null : optionalString(fields, field);
}

/** A field naming a note the API reaches; null where the body says null, undefined when left out. */
function notePath(fields: Fields, field: string): VaultPath | null | undefined {
  if (fields[field] === null) return null;
  const raw = optionalString(fields, field);
  if (raw === undefined) return undefined;
  let path: VaultPath;
  try {
    path = createVaultPath(raw);
  } catch (error) {
    if (error instanceof InvalidVaultPathError) {
      throw new ApiError('invalid', `${field} must be a vault path`);
    }
    throw error;
  }
  if (!isApiNotePath(path)) {
    throw new ApiError(
      'invalid',
      `${field} must be a note: a .md file outside .atlas and hidden folders`,
    );
  }
  return path;
}

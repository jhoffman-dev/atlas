import { invoke } from '@tauri-apps/api/core';
import { kindleAnnotationsUrl, kindleLibraryUrl, type KindleRawPage } from '@dfai/domain';
import {
  isKindleFetchFailureKind,
  KindleFetchError,
  type KindleNotebookSource,
  type KindleSession,
} from '@dfai/application';

/**
 * A Kindle command's rejection as the app's error. The host rejects with a
 * `{ kind, message }` it built; anything else — Tauri refusing the
 * arguments, say — is a request the host could not make.
 */
export function kindleErrorOf(rejection: unknown): KindleFetchError {
  if (rejection instanceof Error) return new KindleFetchError('refused', rejection.message);
  if (typeof rejection !== 'object' || rejection === null) {
    return new KindleFetchError('refused', String(rejection));
  }
  const { kind, message } = rejection as Record<string, unknown>;
  const said = typeof message === 'string' ? message : '';
  return new KindleFetchError(isKindleFetchFailureKind(kind) ? kind : 'refused', said);
}

async function throughHost<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (rejection) {
    throw kindleErrorOf(rejection);
  }
}

/** The host's answer as a page; null when it is not the shape `kindle.rs` sends. */
export function rawPageOf(answer: unknown): KindleRawPage | null {
  if (typeof answer !== 'object' || answer === null) return null;
  const { status, html, redirectedTo } = answer as Record<string, unknown>;
  if (typeof status !== 'number' || !Number.isInteger(status)) return null;
  if (typeof html !== 'string') return null;
  if (redirectedTo !== null && typeof redirectedTo !== 'string') return null;
  return { status, html, redirectedTo };
}

async function fetchPage(url: string): Promise<KindleRawPage> {
  const page = rawPageOf(await throughHost(invoke<unknown>('kindle_fetch_notebook', { url })));
  if (page === null) {
    throw new KindleFetchError('malformed', 'the host answered a page DFAI cannot read');
  }
  return page;
}

/** The notebook through `kindle.rs`, which holds the session and fetches only notebook pages. */
export const tauriKindleNotebook: KindleNotebookSource = {
  fetchLibrary: () => fetchPage(kindleLibraryUrl()),
  fetchAnnotations: ({ asin, cursor }) => fetchPage(kindleAnnotationsUrl(asin, cursor)),
};

/** Connect Kindle's sign-in window, and forgetting the session, through `kindle.rs`. */
export const tauriKindleSession: KindleSession = {
  connect: () => throughHost(invoke<void>('kindle_connect')),
  disconnect: () => throughHost(invoke<void>('kindle_disconnect')),
};

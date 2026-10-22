import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KindleFetchError } from '@dfai/application';

/*
 * The Kindle adapter against a fake `invoke`: the commands and arguments
 * `kindle.rs` takes, the page it answers read into the app's type, and
 * every way the host can fail turned into the app's error.
 */

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { tauriKindleNotebook, tauriKindleSession, kindleErrorOf, rawPageOf } =
  await import('./tauri-kindle.ts');

const PAGE = { status: 200, html: '<div id="kp-notebook-library"></div>', redirectedTo: null };

// A block, not an expression: a function returned from beforeEach is run as its
// teardown, and the mock is a function.
beforeEach(() => {
  invoke.mockReset();
});

/** What a call failed with, as the app's error reads: its kind and message. */
async function failureOf(call: Promise<unknown>) {
  const error: unknown = await call.then(
    () => null,
    (rejection: unknown) => rejection,
  );
  expect(error).toBeInstanceOf(KindleFetchError);
  const { kind, message } = error as KindleFetchError;
  return { kind, message };
}

const read = (error: KindleFetchError) => ({ kind: error.kind, message: error.message });

describe('tauriKindleNotebook', () => {
  it('asks the host for the library at the notebook’s address and hands back its page', async () => {
    invoke.mockResolvedValue(PAGE);
    expect(await tauriKindleNotebook.fetchLibrary()).toEqual(PAGE);
    expect(invoke).toHaveBeenCalledWith('kindle_fetch_notebook', {
      url: 'https://read.amazon.com/notebook',
    });
  });

  it('asks for a book’s page with its ASIN and the cursor', async () => {
    invoke.mockResolvedValue(PAGE);
    await tauriKindleNotebook.fetchAnnotations({
      asin: 'B0EXAMPLE1',
      cursor: { token: 'T2', contentLimitState: 'S' },
    });
    expect(invoke).toHaveBeenCalledWith('kindle_fetch_notebook', {
      url: 'https://read.amazon.com/notebook?asin=B0EXAMPLE1&contentLimitState=S&token=T2',
    });
  });

  it('hands back a redirect the host reports', async () => {
    const redirect = { status: 302, html: '', redirectedTo: 'https://www.amazon.com/ap/signin' };
    invoke.mockResolvedValue(redirect);
    expect(await tauriKindleNotebook.fetchLibrary()).toEqual(redirect);
  });

  it('refuses an answer not in the host’s shape as malformed', async () => {
    invoke.mockResolvedValue({ status: '200', html: '' });
    expect(await failureOf(tauriKindleNotebook.fetchLibrary())).toEqual({
      kind: 'malformed',
      message: 'the host answered a page DFAI cannot read',
    });
  });

  it('turns the host’s rejection into the app’s error, kind and message kept', async () => {
    invoke.mockRejectedValue({ kind: 'timeout', message: 'Amazon took longer than 30 s' });
    expect(await failureOf(tauriKindleNotebook.fetchLibrary())).toEqual({
      kind: 'timeout',
      message: 'Amazon took longer than 30 s',
    });
  });
});

describe('tauriKindleSession', () => {
  it('connects and disconnects through their own commands', async () => {
    invoke.mockResolvedValue(undefined);
    await tauriKindleSession.connect();
    await tauriKindleSession.disconnect();
    expect(invoke.mock.calls).toEqual([['kindle_connect'], ['kindle_disconnect']]);
  });

  it('turns a refusal to connect into the app’s error', async () => {
    invoke.mockRejectedValue({ kind: 'refused', message: 'needs macOS 14' });
    expect(await failureOf(tauriKindleSession.connect())).toEqual({
      kind: 'refused',
      message: 'needs macOS 14',
    });
  });
});

describe('kindleErrorOf', () => {
  it('reads a kind it does not know, a string or an Error as a request the host refused', () => {
    expect(read(kindleErrorOf({ kind: 'exploded', message: 'x' }))).toEqual({
      kind: 'refused',
      message: 'x',
    });
    expect(read(kindleErrorOf('invalid args'))).toEqual({
      kind: 'refused',
      message: 'invalid args',
    });
    expect(read(kindleErrorOf(new Error('boom')))).toEqual({ kind: 'refused', message: 'boom' });
  });

  it('keeps a known kind with no message as an empty one', () => {
    expect(read(kindleErrorOf({ kind: 'not_connected' }))).toEqual({
      kind: 'not_connected',
      message: '',
    });
  });
});

describe('rawPageOf', () => {
  it('reads only an integer status, a string body and a string or null redirect', () => {
    expect(rawPageOf(PAGE)).toEqual(PAGE);
    for (const bad of [
      null,
      'page',
      { ...PAGE, status: 200.5 },
      { ...PAGE, html: null },
      { ...PAGE, redirectedTo: 1 },
      { status: 200, html: '' },
    ]) {
      expect(rawPageOf(bad)).toBeNull();
    }
  });
});

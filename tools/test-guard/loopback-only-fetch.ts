/**
 * A guard for the test run: `fetch` refuses any address that is not this
 * machine's. A test that reaches a real service — Amazon's notebook, above
 * all, with a real session behind it — is a bug, and one that should fail
 * loudly rather than succeed quietly. Loopback is for tests that start a
 * server of their own.
 */

const LOOPBACK_HOST = /^(localhost|127(\.\d{1,3}){3}|\[::1\]|::1)$/i;

/** Whether `input` (a URL, a string or a Request) is a loopback address; a relative one has no host to reach. */
export function isLoopbackUrl(input: string | URL | Request): boolean {
  const written = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  let url: URL;
  try {
    url = new URL(written, 'http://127.0.0.1/');
  } catch {
    // Not an address at all: fetch rejects it itself, without going anywhere.
    return true;
  }
  return LOOPBACK_HOST.test(url.hostname);
}

export class NonLoopbackFetchError extends Error {
  constructor(host: string) {
    super(
      `A test called fetch for ${host}, which is not this machine. Tests reach only 127.0.0.1; ` +
        'use a fake, or a server the test starts itself.',
    );
    this.name = 'NonLoopbackFetchError';
  }
}

/** Replaces `target.fetch` with one that throws for any address off this machine. */
export function installLoopbackOnlyFetch(target: { fetch?: typeof fetch }): void {
  const real = target.fetch;
  if (real === undefined) return;
  target.fetch = (input, init) => {
    if (!isLoopbackUrl(input)) {
      const written =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      throw new NonLoopbackFetchError(new URL(written, 'http://127.0.0.1/').hostname);
    }
    return real(input, init);
  };
}

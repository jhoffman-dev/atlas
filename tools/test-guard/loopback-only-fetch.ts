/**
 * A guard for the test run: nothing a test does may reach an address that is
 * not this machine's. A test that reaches a real service — Amazon's notebook,
 * above all, with a real session behind it — is a bug, and one that should
 * fail loudly rather than succeed quietly. Loopback is for tests that start a
 * server of their own.
 *
 * `fetch` and `XMLHttpRequest` are refused by address, and below them every
 * TCP or TLS socket by host (`net.Socket.prototype.connect`, which
 * `net.connect`, `tls.connect`, node:http's and node:https's agents and undici
 * all open through), and node:http and node:https requests by host before they
 * ask for a connection, which also covers one made with a `createConnection`
 * of the caller's own.
 */
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';

const LOOPBACK_HOST = /^(localhost|127(\.\d{1,3}){3}|\[::1\]|::1)$/i;

/** The base a relative address is read against: one with no host of its own stays here. */
const HERE = 'http://127.0.0.1/';

/** Whether `host` (a name or an address, IPv6 with or without brackets) is this machine. */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOST.test(host);
}

/** The address `input` names, read as fetch reads it: a Request by its URL, anything else by String(). */
function writtenAddress(input: unknown): string {
  return input instanceof Request ? input.url : String(input);
}

/** The host `input` names, or null when it is no address at all (the caller rejects it itself). */
function hostOf(input: unknown, base: string): string | null {
  try {
    return new URL(writtenAddress(input), base).hostname;
  } catch {
    // Not an address at all: fetch and XHR reject it themselves, without going anywhere.
    return null;
  }
}

/** Whether `input` (a URL, a string, a Request or any object read by its string form) is a loopback address; a relative one has no host to reach. */
export function isLoopbackUrl(input: unknown, base = HERE): boolean {
  const host = hostOf(input, base);
  return host === null || isLoopbackHost(host);
}

export class NonLoopbackFetchError extends Error {
  constructor(host: string, via = 'fetch') {
    super(
      `A test called ${via} for ${host}, which is not this machine. Tests reach only 127.0.0.1; ` +
        'use a fake, or a server the test starts itself.',
    );
    this.name = 'NonLoopbackFetchError';
  }
}

function refuseAddress(input: unknown, via: string, base = HERE): void {
  const host = hostOf(input, base);
  if (host !== null && !isLoopbackHost(host)) throw new NonLoopbackFetchError(host, via);
}

/** Replaces `target.fetch` with one that throws for any address off this machine. */
export function installLoopbackOnlyFetch(target: { fetch?: typeof fetch }): void {
  const real = target.fetch;
  if (real === undefined) return;
  target.fetch = (input, init) => {
    refuseAddress(input, 'fetch');
    return real(input, init);
  };
}

/** Makes `XMLHttpRequest#open` throw for any address off this machine (a jsdom window has one). */
export function installLoopbackOnlyXhr(target: { XMLHttpRequest?: typeof XMLHttpRequest }): void {
  const prototype = target.XMLHttpRequest?.prototype;
  if (prototype === undefined) return;
  const realOpen = prototype.open as (this: XMLHttpRequest, ...args: unknown[]) => void;
  prototype.open = function open(this: XMLHttpRequest, ...args: unknown[]) {
    refuseAddress(args[1], 'XMLHttpRequest', globalThis.location?.href ?? HERE);
    realOpen.apply(this, args);
  } as typeof prototype.open;
}

interface ConnectOptions {
  readonly host?: string;
  readonly path?: string;
}

/**
 * The host a `Socket#connect` call dials, or null for a local (IPC) socket.
 * It is called as `(options)`, `(port, host?)`, `(path)`, or — from
 * `net.connect` — with the arguments already gathered into an array.
 */
function dialledHost(args: readonly unknown[]): string | null {
  const first: unknown = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
  if (typeof first === 'object' && first !== null) {
    const { host, path } = first as ConnectOptions;
    if (path !== undefined) return null;
    return host === undefined || host === '' ? 'localhost' : host;
  }
  // A string that is not a port is a socket path, as net reads it.
  if (typeof first === 'string' && !/^\d+$/.test(first)) return null;
  return typeof args[1] === 'string' && args[1] !== '' ? args[1] : 'localhost';
}

interface RequestOptions {
  readonly hostname?: string | null;
  readonly host?: string | null;
  readonly socketPath?: string;
}

/** Whether `value` is a URL, from this realm or another, as node:http takes one. */
function isUrlLike(value: unknown): value is { readonly href: string } {
  return (
    value instanceof URL ||
    (typeof value === 'object' &&
      value !== null &&
      typeof (value as { href?: unknown }).href === 'string' &&
      typeof (value as { protocol?: unknown }).protocol === 'string')
  );
}

/**
 * The host a node:http(s) request is for, read as node:http reads its
 * arguments — `(url?, options?, callback?)`, the options' `hostname`, then
 * `host`, over the URL's — or null for one over a local socket.
 */
function requestedHost(args: readonly unknown[]): string | null {
  let host = 'localhost';
  for (const arg of args.slice(0, 2)) {
    if (typeof arg === 'string' || isUrlLike(arg)) {
      const named = hostOf(typeof arg === 'string' ? arg : arg.href, HERE);
      if (named !== null) host = named;
    } else if (typeof arg === 'object' && arg !== null) {
      const options = arg as RequestOptions;
      if (options.socketPath !== undefined) return null;
      host = options.hostname ?? options.host ?? host;
    }
  }
  return host;
}

type Opener = (...args: unknown[]) => unknown;

/** Wraps `module[name]` so it throws, before it does anything, for a host off this machine. */
function guardOpener(
  module: Record<string, unknown>,
  name: string,
  hostIn: (args: readonly unknown[]) => string | null,
  via: string,
): void {
  const real = module[name] as Opener;
  module[name] = function guarded(this: unknown, ...args: unknown[]) {
    const host = hostIn(args);
    if (host !== null && !isLoopbackHost(host)) throw new NonLoopbackFetchError(host, via);
    return real.apply(this, args);
  };
}

/** Refuses every socket, and every node:http(s) request, to a host off this machine. */
export function installLoopbackOnlySockets(): void {
  guardOpener(
    net.Socket.prototype as unknown as Record<string, unknown>,
    'connect',
    dialledHost,
    'a socket',
  );
  for (const [module, via] of [
    [http, 'node:http'],
    [https, 'node:https'],
  ] as const) {
    for (const name of ['request', 'get']) {
      guardOpener(module as unknown as Record<string, unknown>, name, requestedHost, via);
    }
  }
  // So a named import (`import { request } from 'node:http'`) gets the guarded one too.
  syncBuiltinESMExports();
}

/** Installs every guard: fetch and XHR on `target`, and the sockets and requests below them. */
export function installLoopbackOnlyNetwork(target: {
  fetch?: typeof fetch;
  XMLHttpRequest?: typeof XMLHttpRequest;
}): void {
  installLoopbackOnlyFetch(target);
  installLoopbackOnlyXhr(target);
  installLoopbackOnlySockets();
}

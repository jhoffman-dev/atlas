import { once } from 'node:events';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import net, { type AddressInfo, type LookupFunction, type Socket } from 'node:net';
import { Duplex } from 'node:stream';
import tls from 'node:tls';
import { describe, expect, it, vi } from 'vitest';
import {
  installLoopbackOnlyFetch,
  isLoopbackUrl,
  NonLoopbackFetchError,
} from './loopback-only-fetch.ts';

describe('isLoopbackUrl', () => {
  it('accepts this machine by name, by IPv4 and by IPv6, and a relative address', () => {
    for (const address of [
      'http://127.0.0.1:8080/x',
      'https://localhost/x',
      'http://LOCALHOST:3000',
      'http://127.1.2.3/',
      'http://[::1]:9/',
      '/notebook',
    ]) {
      expect(isLoopbackUrl(address), address).toBe(true);
    }
    expect(isLoopbackUrl(new URL('http://127.0.0.1:1/'))).toBe(true);
    expect(isLoopbackUrl(new Request('http://127.0.0.1:1/'))).toBe(true);
  });

  it('refuses every other host, however it is written to look local', () => {
    for (const address of [
      'https://read.amazon.com/notebook',
      'http://203.0.113.7/',
      'https://localhost.example.invalid/',
      'http://127.0.0.1.example.invalid/',
      'http://example.invalid@read.amazon.com/',
      'https://[2001:db8::1]/',
      'http://0.0.0.0/',
    ]) {
      expect(isLoopbackUrl(address), address).toBe(false);
    }
    expect(isLoopbackUrl(new URL('https://read.amazon.com/'))).toBe(false);
    expect(isLoopbackUrl(new Request('https://read.amazon.com/'))).toBe(false);
  });
});

describe('installLoopbackOnlyFetch', () => {
  it('throws for an address off this machine without calling the real fetch', () => {
    const real = vi.fn(() => Promise.resolve(new Response('real')));
    const target = { fetch: real as unknown as typeof fetch };
    installLoopbackOnlyFetch(target);
    expect(() => target.fetch('https://read.amazon.com/notebook')).toThrow(NonLoopbackFetchError);
    expect(() => target.fetch('https://read.amazon.com/notebook')).toThrow(/read\.amazon\.com/);
    expect(real).not.toHaveBeenCalled();
  });

  it('passes a loopback address through to the real fetch', async () => {
    const real = vi.fn(() => Promise.resolve(new Response('real')));
    const target = { fetch: real as unknown as typeof fetch };
    installLoopbackOnlyFetch(target);
    const response = await target.fetch('http://127.0.0.1:1/', { method: 'GET' });
    expect(await response.text()).toBe('real');
    expect(real).toHaveBeenCalledWith('http://127.0.0.1:1/', { method: 'GET' });
  });

  it('leaves a target with no fetch alone', () => {
    const target: { fetch?: typeof fetch } = {};
    installLoopbackOnlyFetch(target);
    expect(target.fetch).toBeUndefined();
  });
});

describe('the test run', () => {
  it('has the guard installed on the global fetch', () => {
    expect(() => globalThis.fetch('https://read.amazon.com/notebook')).toThrow(
      NonLoopbackFetchError,
    );
  });
});

/*
 * Verification of PR #511: the run's guard below fetch. Nothing here reaches past this machine
 * even if the guard were broken: a request off it names a host whose look-up the test refuses,
 * or a connection of the test's own that goes nowhere, so there is no DNS query and no connect.
 */

const OFF_MACHINE = 'https://read.amazon.com/notebook';
const OFF_HOST = 'read.amazon.com';

/** A look-up that refuses, and counts that it was asked: a broken guard is seen, not sent. */
function refusedLookup(): LookupFunction & { readonly asked: () => number } {
  let asked = 0;
  const lookup = ((_host: string, _options: unknown, done: (error: Error) => void) => {
    asked += 1;
    done(new Error('no look-ups in tests'));
  }) as unknown as LookupFunction & { asked: () => number };
  lookup.asked = () => asked;
  return lookup;
}

/** The part of undici the test uses. */
interface UndiciSurface {
  readonly Agent: new (options: { readonly connect: { readonly lookup: LookupFunction } }) => {
    close(): Promise<void>;
  };
  request(url: string, options: { readonly dispatcher: unknown }): Promise<unknown>;
}

/** Whether `open` threw the guard's refusal, rather than reaching for a connection. */
function refused(open: () => unknown): boolean {
  try {
    const opened = open();
    // Dropped on purpose: a connection the guard missed is torn down, and its error is not what is tested.
    if (opened instanceof http.ClientRequest || opened instanceof net.Socket) {
      opened.on('error', () => {});
      opened.destroy();
    }
    return false;
  } catch (error) {
    return error instanceof NonLoopbackFetchError;
  }
}

describe('the loopback-only guard, verified', () => {
  it('refuses an address given as an object that fetch reads by its string form', () => {
    // fetch reads any object by String(); a URL from another realm (jsdom, vm) is not instanceof URL.
    const real = vi.fn(() => Promise.resolve(new Response('')));
    const target: { fetch?: typeof fetch } = { fetch: real as unknown as typeof fetch };
    installLoopbackOnlyFetch(target);
    const crossRealmUrl = { href: OFF_MACHINE, toString: () => OFF_MACHINE };
    // The cast is the misuse under test: fetch's own types do not take a URL-like object.
    expect(() => target.fetch?.(crossRealmUrl as unknown as URL)).toThrow(/not this machine/);
    expect(real).not.toHaveBeenCalled();
  });

  it('refuses an HTTP request off this machine made with node:http, not only fetch', () => {
    // The connection is a stream that goes nowhere: what is written to it is dropped.
    const nowhere = () =>
      new Duplex({
        read() {},
        write(_chunk, _encoding, done) {
          done();
        },
      });
    const connect = vi.fn(nowhere);
    let refusedByGuard = false;
    try {
      const request = http.request({
        host: 'read.amazon.com',
        path: '/notebook',
        createConnection: connect as unknown as () => Socket,
      });
      // Dropped on purpose: the stream is torn down below, and its error is not what is tested.
      request.on('error', () => {});
      request.destroy();
    } catch {
      refusedByGuard = true;
    }
    expect({ refusedByGuard, connectionAsked: connect.mock.calls.length > 0 }).toEqual({
      refusedByGuard: true,
      connectionAsked: false,
    });
  });

  it('refuses node:http and node:https requests off this machine, by options or by address', () => {
    const lookup = refusedLookup();
    expect(refused(() => http.get(`http://${OFF_HOST}/notebook`, { lookup }))).toBe(true);
    expect(refused(() => http.request(new URL(OFF_MACHINE), { lookup }))).toBe(true);
    expect(refused(() => https.request({ hostname: OFF_HOST, lookup }))).toBe(true);
    expect(refused(() => https.get(OFF_MACHINE, { lookup }))).toBe(true);
    expect(lookup.asked()).toBe(0);
  });

  it('refuses a socket off this machine however it is opened', () => {
    const lookup = refusedLookup();
    expect(refused(() => net.connect({ host: OFF_HOST, port: 443, lookup }))).toBe(true);
    expect(refused(() => net.createConnection({ host: OFF_HOST, port: 443, lookup }))).toBe(true);
    expect(refused(() => new net.Socket().connect({ host: OFF_HOST, port: 443, lookup }))).toBe(
      true,
    );
    expect(refused(() => tls.connect({ host: OFF_HOST, port: 443, lookup }))).toBe(true);
    // An agent's own connection, as node:http and node:https make one under a request.
    const agent = new https.Agent();
    expect(
      refused(() =>
        (agent as unknown as { createConnection: (options: object) => Socket }).createConnection({
          host: OFF_HOST,
          port: 443,
          lookup,
        }),
      ),
    ).toBe(true);
    agent.destroy();
    expect(lookup.asked()).toBe(0);
  });

  it('refuses a request undici makes itself, below fetch', async () => {
    // undici as jsdom has it: the library Node's own fetch is built on, used directly.
    const fromJsdom = createRequire(createRequire(import.meta.url).resolve('jsdom'));
    // Typed here, as jsdom's own dependency is not one of the repo's.
    const undici = fromJsdom('undici') as UndiciSurface;
    const lookup = refusedLookup();
    const dispatcher = new undici.Agent({ connect: { lookup } });
    await expect(undici.request(OFF_MACHINE, { dispatcher })).rejects.toThrow(/not this machine/);
    await dispatcher.close();
    expect(lookup.asked()).toBe(0);
  });

  it('lets a socket and a request to a server of the test’s own on this machine through', async () => {
    const server = http.createServer((_request, response) => response.end('here'));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    try {
      const socket = net.connect({ host: '127.0.0.1', port });
      await once(socket, 'connect');
      socket.destroy();
      const answer = await new Promise<string>((resolve, reject) => {
        http
          .get({ host: 'localhost', port, path: '/' }, (response) => {
            let body = '';
            response.on('data', (chunk: Buffer) => (body += chunk.toString()));
            response.on('end', () => resolve(body));
          })
          .on('error', reject);
      });
      expect(answer).toBe('here');
    } finally {
      server.close();
    }
  });
});

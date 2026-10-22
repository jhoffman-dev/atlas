import http from 'node:http';
import type { Socket } from 'node:net';
import { Duplex } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { installLoopbackOnlyFetch } from './loopback-only-fetch.ts';

/*
 * Verification of PR #511: the test run's guard against reaching a host off this machine. Nothing
 * here opens a socket: the "real" fetch is a spy, and the HTTP request's connection is a stream
 * of the test's own that goes nowhere, so there is no lookup or connect.
 */

const OFF_MACHINE = 'https://read.amazon.com/notebook';

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
});

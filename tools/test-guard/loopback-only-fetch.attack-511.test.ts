import http from 'node:http';
import net, { type LookupFunction } from 'node:net';
import { describe, expect, it } from 'vitest';
import { NonLoopbackFetchError } from './loopback-only-fetch.ts';

/*
 * Second verification of PR #511 (after the fix round at b4e81c01): ways past the run's socket
 * guard. Nothing here reaches past this machine even with the guard broken: a host by name has
 * a look-up the test refuses (no DNS query), and an address by number has a port net refuses
 * before it dials (no connect).
 */

const OFF_HOST = 'read.amazon.com';
// TEST-NET-3 (RFC 5737), with a port above 65535: net throws ERR_SOCKET_BAD_PORT before dialling.
const OFF_ADDRESS = '203.0.113.7';
const BAD_PORT = ' 70000';

/** A look-up that refuses: a broken guard reaches it, and goes no further. */
const refusedLookup = ((_host: string, _options: unknown, done: (error: Error) => void) => {
  done(new Error('no look-ups in tests'));
}) as unknown as LookupFunction;

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

describe('the loopback-only guard, against ways past it', () => {
  it('refuses a socket whose port is a string net reads as a number (" 443"), not a socket path', () => {
    // Typed as a number, as net's types have it; net itself takes the string and reads it so.
    const port = BAD_PORT as unknown as number;
    expect(refused(() => new net.Socket().connect(port, OFF_ADDRESS))).toBe(true);
  });

  it('refuses a socket whose options carry an empty or null path, which net dials as TCP', () => {
    for (const path of ['', null]) {
      const options = { host: OFF_HOST, port: 443, path, lookup: refusedLookup };
      expect(
        refused(() => new net.Socket().connect(options as unknown as net.SocketConnectOpts)),
        String(path),
      ).toBe(true);
    }
  });

  it('refuses the connection node:http’s agent opens, which names the path as null', () => {
    // A ClientRequest made directly is not http.request, so only the socket guard stands here.
    const options = { host: OFF_HOST, port: 80, lookup: refusedLookup };
    expect(refused(() => new http.ClientRequest(options))).toBe(true);
  });

  it('refuses a node:http request with an empty socketPath, which node:http dials as TCP', () => {
    expect(
      refused(() =>
        http.request({ host: OFF_HOST, port: 80, socketPath: '', lookup: refusedLookup }),
      ),
    ).toBe(true);
  });
});

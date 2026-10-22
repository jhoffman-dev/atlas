// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { NonLoopbackFetchError } from './loopback-only-fetch.ts';

/*
 * Verification of PR #511: XMLHttpRequest, in a test with a window, refuses an address off this
 * machine when it is opened, before anything is sent.
 */

describe('the loopback-only guard under jsdom', () => {
  it('refuses to open an XMLHttpRequest off this machine, however the address is given', () => {
    const offMachine = 'https://read.amazon.com/notebook';
    for (const address of [
      offMachine,
      new URL(offMachine),
      { toString: () => offMachine } as unknown as string,
    ]) {
      const request = new XMLHttpRequest();
      expect(() => request.open('GET', address), String(address)).toThrow(NonLoopbackFetchError);
    }
  });

  it('opens one on this machine', () => {
    const request = new XMLHttpRequest();
    expect(() => request.open('GET', 'http://127.0.0.1:1/')).not.toThrow();
  });
});

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

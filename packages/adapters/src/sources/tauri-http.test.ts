import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { HttpRequest } from '@atlas/domain';
import { HttpFetchError } from '@atlas/application';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { tauriHttp } = await import('./tauri-http.ts');

const plain = (url: string): HttpRequest => ({ url: [{ text: url }], headers: [] });

describe('tauriHttp', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('asks the host for the request it was given', async () => {
    invoke.mockResolvedValue('id,name\n');
    const request = plain('https://example.test/people.csv');
    await expect(tauriHttp.get({ request, vault: '/v' })).resolves.toBe('id,name\n');
    expect(invoke).toHaveBeenCalledWith('http_get', { request, vault: '/v' });
  });

  it('passes secrets on as names for the host to fill in', async () => {
    invoke.mockResolvedValue('');
    const request: HttpRequest = {
      url: [{ text: 'https://api.test/items' }],
      headers: [{ name: 'Authorization', value: [{ text: 'Bearer ' }, { secret: 'github' }] }],
    };
    await tauriHttp.get({ request, vault: '/v' });
    expect(invoke).toHaveBeenCalledWith('http_get', { request, vault: '/v' });
  });

  it('turns the host refusal into an error a use-case can report', async () => {
    invoke.mockRejectedValue('a source can only be fetched over http or https, not file:');
    const error = await tauriHttp
      .get({ request: plain('file:///etc/passwd'), vault: '/v' })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(HttpFetchError);
    expect((error as Error).message).toContain('http or https');
  });
});

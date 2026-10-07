import { describe, expect, it } from 'vitest';
import { VaultAccessError } from '@atlas/application';
import { throughHost } from './host-error.ts';

describe('throughHost', () => {
  it('passes a successful value straight through', async () => {
    await expect(throughHost(Promise.resolve(42))).resolves.toBe(42);
  });

  it('wraps the bare string Tauri rejects with into a VaultAccessError', async () => {
    const error = await throughHost(Promise.reject('no vault is open')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VaultAccessError);
    expect((error as Error).message).toBe('no vault is open');
  });

  it('keeps an existing Error as it is, so stacks survive', async () => {
    const original = new TypeError('already an error');
    const error = await throughHost(Promise.reject(original)).catch((e: unknown) => e);
    expect(error).toBe(original);
  });

  it('raises the error the caller asked for instead of a vault one', async () => {
    const error = await throughHost(
      Promise.reject('the feed answered 404'),
      (message) => new RangeError(message),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RangeError);
    expect((error as Error).message).toBe('the feed answered 404');
  });

  it('describes a non-string rejection rather than losing it', async () => {
    const error = await throughHost(Promise.reject({ code: 7 })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VaultAccessError);
    expect((error as Error).message).toContain('object');
  });
});

import { describe, expect, it } from 'vitest';
import { activityEvent } from './activity-event.ts';

/**
 * Adversarial (U-28): a line is kept for a month in a file any local process
 * can read, so the words that reach it must be free of this Mac's paths and
 * of secret values, whatever shape an error's words arrive in.
 */

const NOW = Date.UTC(2026, 8, 28, 9);

const kept = (message: string) =>
  activityEvent({ at: NOW, level: 'error', kind: 'app', message, subject: null }).message;

describe('an Activity line never names a place on this Mac', () => {
  it.each([
    ['square brackets', 'cannot open [/Users/jhoffman/Private Vault/diary.md]'],
    ['angle brackets', 'cannot open </Users/jhoffman/Private Vault/diary.md>'],
    [
      'backticks, as Rust and Tauri quote a path',
      'path `/Users/jhoffman/Private Vault/diary.md` is not allowed',
    ],
    ['braces', 'bad entry {/Users/jhoffman/Private Vault/diary.md}'],
    [
      'curly quotes, as macOS quotes a path',
      'The file “/Users/jhoffman/Private Vault/diary.md” could not be opened.',
    ],
    ['single curly quotes', 'EACCES, open ‘/Users/jhoffman/Private Vault/diary.md’'],
  ])('strips an absolute path wrapped in %s', (_shape, message) => {
    const line = kept(message);
    expect(line).not.toContain('jhoffman');
    expect(line).not.toContain('/Users/');
  });

  it('strips a path under the home folder written with ~', () => {
    const line = kept('no such file: ~/Documents/Private Vault/diary.md');
    expect(line).not.toContain('~/Documents');
    expect(line).not.toContain('Private Vault');
  });
});

describe('an Activity line never carries a secret value', () => {
  it.each([
    ['a key named with a space', 'api key: s3cr3t-value-from-server'],
    ['a cookie a server echoed', 'Cookie: session=abcdef0123456789abcdef'],
    ['a lower-case hex key after key=', 'refused key=d41d8cd98f00b204e9800998ecf8427e'],
    ['a 40-hex token a server echoed', 'bad credentials 0123456789abcdef0123456789abcdef01234567'],
    ['an AWS secret access key', 'signature mismatch for wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'],
    ['a Bearer scheme followed by a colon', 'Bearer: abcdefghijklmnop1234'],
    ['a JSON value holding a space', '{"api_key": "correct horse battery staple"}'],
  ])('redacts %s', (_shape, message) => {
    const line = kept(message);
    const secret =
      /(s3cr3t-value-from-server|abcdef0123456789abcdef|d41d8cd98f00b204e9800998ecf8427e|0123456789abcdef0123456789abcdef01234567|wJalrXUtnFEMI|abcdefghijklmnop1234|horse battery staple)/;
    expect(line).not.toMatch(secret);
  });
});

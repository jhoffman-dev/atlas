import { describe, expect, it } from 'vitest';
import {
  isSecretName,
  parseSecretOrigins,
  parseSecretTemplate,
  secretNamesIn,
  SecretReferenceError,
  templateText,
} from './secrets.ts';

describe('isSecretName', () => {
  it('accepts letters, digits, dots, dashes and underscores', () => {
    expect(isSecretName('github')).toBe(true);
    expect(isSecretName('google.calendar_2-work')).toBe(true);
  });

  it('refuses an empty name, a space, a slash, and a leading dot', () => {
    expect(isSecretName('')).toBe(false);
    expect(isSecretName('git hub')).toBe(false);
    // The keychain account is `<vault>/<name>`: a slash would reach another vault's.
    expect(isSecretName('../other/github')).toBe(false);
    expect(isSecretName('other/github')).toBe(false);
    expect(isSecretName('.hidden')).toBe(false);
  });

  it('refuses a name longer than 64', () => {
    expect(isSecretName('a'.repeat(64))).toBe(true);
    expect(isSecretName('a'.repeat(65))).toBe(false);
  });
});

describe('parseSecretTemplate', () => {
  it('reads plain text as one piece', () => {
    expect(parseSecretTemplate('application/json')).toEqual([{ text: 'application/json' }]);
  });

  it('reads nothing from nothing', () => {
    expect(parseSecretTemplate('')).toEqual([]);
  });

  it('splits a secret out of the text around it', () => {
    expect(parseSecretTemplate('Bearer {{secret:github}}')).toEqual([
      { text: 'Bearer ' },
      { secret: 'github' },
    ]);
  });

  it('reads several, and space inside the braces', () => {
    expect(parseSecretTemplate('https://x.test/{{ secret: user }}/{{secret:key}}.ics')).toEqual([
      { text: 'https://x.test/' },
      { secret: 'user' },
      { text: '/' },
      { secret: 'key' },
      { text: '.ics' },
    ]);
  });

  it('refuses an empty or unusable name rather than sending it as text', () => {
    expect(() => parseSecretTemplate('Bearer {{secret:}}')).toThrow(SecretReferenceError);
    expect(() => parseSecretTemplate('Bearer {{secret:git hub}}')).toThrow(/git hub/);
  });

  it('refuses a reference that is never closed', () => {
    expect(() => parseSecretTemplate('Bearer {{secret:github')).toThrow(/not closed/);
  });

  it('leaves braces that are not a secret alone', () => {
    expect(parseSecretTemplate('{{name}}')).toEqual([{ text: '{{name}}' }]);
  });
});

describe('secretNamesIn', () => {
  it('names each secret once, in order', () => {
    const parts = parseSecretTemplate('{{secret:b}}{{secret:a}}{{secret:b}}');
    expect(secretNamesIn(parts)).toEqual(['b', 'a']);
  });
});

describe('templateText', () => {
  it('writes a template back as references, never as values', () => {
    expect(templateText(parseSecretTemplate('Bearer {{ secret: github }}'))).toBe(
      'Bearer {{secret:github}}',
    );
  });
});

describe('parseSecretOrigins', () => {
  it('writes each site as the origin the host compares: https, lower case, no default port', () => {
    expect(parseSecretOrigins('https://API.GitHub.com:443/')).toEqual(['https://api.github.com']);
    expect(parseSecretOrigins('https://ghe.test:8443')).toEqual(['https://ghe.test:8443']);
  });

  it('takes a bare host as https, since a secret is only ever sent over https', () => {
    expect(parseSecretOrigins('api.github.com')).toEqual(['https://api.github.com']);
  });

  it('takes several, separated by commas or spaces, each once and in order', () => {
    expect(parseSecretOrigins(' api.test, https://b.test  api.test\nc.test ')).toEqual([
      'https://api.test',
      'https://b.test',
      'https://c.test',
    ]);
  });

  it('refuses a site with a path, query, fragment or login, since it would not be the site', () => {
    for (const input of [
      'https://api.test/repos',
      'https://api.test/?q=1',
      'https://api.test/#x',
      'https://me@api.test',
      'https://me:pw@api.test',
    ]) {
      expect(parseSecretOrigins(input), input).toBeNull();
    }
  });

  it('refuses plain http, another scheme, nothing at all, and text that is not a site', () => {
    expect(parseSecretOrigins('http://api.test')).toBeNull();
    expect(parseSecretOrigins('ftp://api.test')).toBeNull();
    expect(parseSecretOrigins('   ')).toBeNull();
    expect(parseSecretOrigins('https://')).toBeNull();
    // One bad entry refuses the lot, rather than binding to fewer sites than typed.
    expect(parseSecretOrigins('api.test, http://b.test')).toBeNull();
  });
});

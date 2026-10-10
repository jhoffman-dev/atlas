import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { MAX_ACTIVITY_MESSAGE, activityEvent, insideVault } from './activity-event.ts';
import { withoutSecrets } from './without-secrets.ts';

const AT = Date.UTC(2026, 8, 28, 9, 30);

const event = (message: string, path: string | null = null) =>
  activityEvent({
    at: AT,
    level: 'error',
    kind: 'save',
    message,
    // A subject as a file or a careless caller could hand it over: any string at all.
    subject:
      path === null ? null : { kind: 'note', path: path as ReturnType<typeof createVaultPath> },
  });

describe('activityEvent', () => {
  it('keeps the time, level, kind and a subject inside the vault', () => {
    const made = event('Could not save', 'Tasks/Call.md');
    expect(made).toEqual({
      at: AT,
      level: 'error',
      kind: 'save',
      message: 'Could not save',
      subject: { kind: 'note', path: 'Tasks/Call.md' },
    });
  });

  it('strips absolute paths from the message', () => {
    const made = event('unable to open /Users/james/My Vault/.atlas/index.sqlite: locked');
    expect(made.message).toBe('unable to open <path>: locked');
    expect(made.message).not.toContain('/Users/');
  });

  it('strips a Windows path too', () => {
    expect(event('cannot read C:\\Users\\james\\notes.md').message).toBe('cannot read <path>');
  });

  it('strips secret values from the message', () => {
    const made = event('401 from server; sent Authorization: Bearer abcdefghijklmnop12345');
    expect(made.message).not.toContain('abcdefghijklmnop12345');
    expect(made.message).toContain('<secret>');
  });

  it('puts a message of many lines on one', () => {
    expect(event('first line\n  second line\r\n\tthird').message).toBe(
      'first line second line third',
    );
  });

  it('cuts a long message short, and says so', () => {
    const made = event('word '.repeat(200));
    expect(made.message.length).toBe(MAX_ACTIVITY_MESSAGE);
    expect(made.message.endsWith('…')).toBe(true);
  });

  it('leaves a message at the limit whole', () => {
    const exact = 'a'.repeat(MAX_ACTIVITY_MESSAGE);
    expect(event(exact).message).toBe(exact);
  });

  it('says there was no detail rather than showing nothing', () => {
    expect(event('   \n ').message).toBe('No detail was given.');
  });

  it.each([
    ['/Users/james/Vault/a.md'],
    ['C:/Vault/a.md'],
    ['../outside.md'],
    ['Tasks/../../etc/passwd'],
    ['a\\b.md'],
    [''],
  ])('drops a subject that is not a place in the vault: %s', (path) => {
    expect(event('x', path).subject).toBeNull();
  });
});

describe('activityEvent and chat notes, whose names are the question', () => {
  const QUESTION = 'Should Mara Quill get a raise';
  const CHAT = `Chats/${QUESTION}.md`;

  it.each([
    ['bare', `Could not save ${CHAT}. It changed since it was read.`],
    ['quoted', `"${CHAT}" is in Chats/, the record of past chats.`],
    ['under another folder', `Could not move Archive/${CHAT} back`],
    ['without its extension', `cannot open chats/${QUESTION}`],
    ['under a machine path', `unable to write /Users/mara/Vault/${CHAT}: denied`],
  ])('says a chat note named in the words, %s, as a chat note', (_, words) => {
    const made = event(words);
    expect(made.message).not.toContain('Mara Quill');
    expect(made.message).not.toContain('raise');
  });

  it.each(["'", '`', '!', ',', ';', ')', '}', '’', '”', '»', '"', '.', ':', '?', ']', '>'])(
    'says a chat note whose name starts with %s as a chat note, in a line about no note',
    (first) => {
      const line = `Left Chats/${first}${QUESTION}.md out of the sync: it is over 100 MB.`;
      const made = event(line);
      expect(made.message).toBe('Left a chat note out of the sync: it is over 100 MB.');
    },
  );

  it('keeps the words around a chat note it names', () => {
    expect(event(`Could not save ${CHAT}. It changed since it was read.`).message).toBe(
      'Could not save a chat note. It changed since it was read.',
    );
  });

  it('leaves the Chats folder named alone', () => {
    expect(event('The chat could not be saved to Chats/.').message).toBe(
      'The chat could not be saved to Chats/.',
    );
  });

  it('drops a chat note as the subject, and its title from the words', () => {
    const made = event(`Edited ${QUESTION}, as Claude proposed.`, CHAT);
    expect(made.subject).toBeNull();
    expect(made.message).toBe('Edited a chat note, as Claude proposed.');
  });

  it('keeps a note outside Chats as the subject, title and all', () => {
    const made = event('Edited Chats and Things, as Claude proposed.', 'Chats and Things.md');
    expect(made.subject).toEqual({ kind: 'note', path: 'Chats and Things.md' });
    expect(made.message).toBe('Edited Chats and Things, as Claude proposed.');
  });
});

describe('insideVault', () => {
  it('gives back a relative path as a vault path', () => {
    expect(insideVault('Sources/Feed.md')).toBe(createVaultPath('Sources/Feed.md'));
  });

  it('refuses the root itself, which is no subject to open', () => {
    expect(insideVault('/')).toBeNull();
    expect(insideVault('')).toBeNull();
  });
});

describe('withoutSecrets', () => {
  it.each([
    ['Bearer sk-live-abcdefgh', 'Bearer <secret>'],
    ['basic dXNlcjpwYXNzd29yZA==', 'basic <secret>'],
    ['GET https://api.example.com/items?api_key=abc123&page=2', 'api_key=<secret>&page=2'],
    ['{"password": "hunter2"}', '"password": "<secret>"'],
    ['x-api-key: 0123abcd', 'x-api-key: <secret>'],
    ['token=deadbeef', 'token=<secret>'],
    ['key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA used', 'key <secret> used'],
    ['pushed with ghp_abcdefghijklmnopqrstuvwxyz0123', 'pushed with <secret>'],
    ['AKIAABCDEFGHIJKLMNOP is the id', '<secret> is the id'],
    ['xoxb-1234567890-abcdef', '<secret>'],
    ['token aZ3kP9qL2mN8vB4xC7tR1yU6wE5sD0fG ok', '<secret> ok'],
  ])('replaces the value in %s', (text, expected) => {
    expect(withoutSecrets(text)).toContain(expected);
  });

  it('leaves the name in a {{secret:name}} reference, which holds no value', () => {
    expect(withoutSecrets('the secret "github" is not set: {{secret:github}}')).toBe(
      'the secret "github" is not set: {{secret:github}}',
    );
  });

  it.each([
    ['a scheme word in prose', 'Basic information about the vault was missing'],
    ['a key named in prose', 'the frontmatter is missing key: title'],
    ['a note path of mixed case and digits', 'moved Areas/Health/Workouts2026/January Plan'],
    ['a UUID', 'no row 550e8400-e29b-41d4-a716-446655440000 in the index'],
    ['a commit named as one', 'built from commit 3f786850e387550fdab836ed7e6dc881de23001b'],
    ['a token word in prose', 'the token expired, sign in again'],
  ])('leaves %s alone', (_, plain) => {
    expect(withoutSecrets(plain)).toBe(plain);
  });

  it('leaves ordinary words, slugs and lower-case digests alone', () => {
    const plain =
      'Archived 3 notes from weekly-review-2026-09-28-and-some-more-words to Archive, sha 3f786850e387550fdab836ed7e6dc881de23001b';
    expect(withoutSecrets(plain)).toBe(plain);
  });
});

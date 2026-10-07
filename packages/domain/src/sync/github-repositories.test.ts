import { describe, expect, it } from 'vitest';
import { GitHubListError, parseRepositoryList, searchRepositories } from './github-repositories.ts';

/** What `gh repo list --json name,nameWithOwner,defaultBranchRef,visibility,url` prints. */
const listed = (entries: readonly unknown[]) => JSON.stringify(entries);

const notes = {
  name: 'notes',
  nameWithOwner: 'james/notes',
  defaultBranchRef: { name: 'main' },
  visibility: 'PRIVATE',
  url: 'https://github.com/james/notes',
};

describe('parseRepositoryList', () => {
  it('reads each repository: its name, owner, default branch, privacy and address', () => {
    expect(parseRepositoryList(listed([notes]))).toEqual([
      {
        name: 'notes',
        nameWithOwner: 'james/notes',
        defaultBranch: 'main',
        isPrivate: true,
        url: 'https://github.com/james/notes',
      },
    ]);
  });

  it('sorts by owner and name', () => {
    const repositories = parseRepositoryList(
      listed([
        { ...notes, name: 'b', nameWithOwner: 'james/b', url: 'https://github.com/james/b' },
        { ...notes, name: 'a', nameWithOwner: 'ada/a', url: 'https://github.com/ada/a' },
        { ...notes, name: 'a', nameWithOwner: 'james/a', url: 'https://github.com/james/a' },
      ]),
    );
    expect(repositories.map(({ nameWithOwner }) => nameWithOwner)).toEqual([
      'ada/a',
      'james/a',
      'james/b',
    ]);
  });

  it('reads an empty repository as having no default branch, and a public one as public', () => {
    const [empty] = parseRepositoryList(
      listed([{ ...notes, defaultBranchRef: null, visibility: 'PUBLIC' }]),
    );
    expect(empty).toMatchObject({ defaultBranch: null, isPrivate: false });
    const [blank] = parseRepositoryList(listed([{ ...notes, defaultBranchRef: { name: '' } }]));
    expect(blank?.defaultBranch).toBeNull();
  });

  it('takes anything but PUBLIC for private: an internal repository is not open to all', () => {
    const [internal] = parseRepositoryList(listed([{ ...notes, visibility: 'INTERNAL' }]));
    expect(internal?.isPrivate).toBe(true);
  });

  it.each([
    ['no name', { ...notes, name: '' }],
    ['no owner', { ...notes, nameWithOwner: undefined }],
    ['no address', { ...notes, url: null }],
    ['an address with a token in it', { ...notes, url: 'https://x:ghp_token@github.com/a/b' }],
    ['an address that runs a program', { ...notes, url: 'ext::sh -c touch% /tmp/x' }],
    ['not an object', 'james/notes'],
    ['nothing', null],
  ])('leaves out an entry with %s', (_, entry) => {
    expect(parseRepositoryList(listed([entry, notes]))).toHaveLength(1);
  });

  it.each(['not json', '{"repositories": []}', ''])(
    'refuses a listing that is not a list: %j',
    (json) => {
      expect(() => parseRepositoryList(json)).toThrow(GitHubListError);
    },
  );
});

describe('searchRepositories', () => {
  const repositories = parseRepositoryList(
    listed([
      notes,
      {
        ...notes,
        name: 'old-vault',
        nameWithOwner: 'james/old-vault',
        url: 'https://github.com/james/old-vault',
      },
      { ...notes, name: 'Café', nameWithOwner: 'ada/Café', url: 'https://github.com/ada/Cafe' },
    ]),
  );
  const found = (query: string) =>
    searchRepositories(repositories, query).map(({ nameWithOwner }) => nameWithOwner);

  it('finds every repository for an empty search', () => {
    expect(found('')).toHaveLength(3);
    expect(found('   ')).toHaveLength(3);
  });

  it('finds by any part of the owner or the name, case aside', () => {
    expect(found('VAULT')).toEqual(['james/old-vault']);
    expect(found('ada')).toEqual(['ada/Café']);
  });

  it('needs every word of the search', () => {
    expect(found('james old')).toEqual(['james/old-vault']);
    expect(found('james zzz')).toEqual([]);
  });

  it('matches accents either way', () => {
    expect(found('cafe')).toEqual(['ada/Café']);
    expect(found('café')).toEqual(['ada/Café']);
  });
});

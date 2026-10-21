import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  dismissDuplicateChanges,
  dismissedDuplicates,
  duplicatePairKey,
  NOT_DUPLICATE_PEOPLE_KEY,
  possibleDuplicates,
  type DuplicateCandidate,
} from './possible-duplicates.ts';

const person = (
  path: string,
  { emails = [], aliases = [] }: { emails?: string[]; aliases?: string[] } = {},
): DuplicateCandidate => ({
  path: createVaultPath(path),
  name: path.split('/').at(-1)!.replace(/\.md$/, ''),
  emails,
  aliases,
});

const find = (people: DuplicateCandidate[], dismissed: Set<string> = new Set()) =>
  possibleDuplicates({ people, dismissed });

const pairsOf = (people: DuplicateCandidate[], dismissed?: Set<string>) =>
  find(people, dismissed).map((pair) => `${pair.left.path} + ${pair.right.path}`);

describe('possible duplicate people', () => {
  it('finds the same name in two folders', () => {
    const [pair] = find([person('Tobias Fenn.md'), person('People/Tobias Fenn.md')]);
    expect(pair?.left.path).toBe('People/Tobias Fenn.md');
    expect(pair?.right.path).toBe('Tobias Fenn.md');
    expect(pair?.reasons).toEqual([{ kind: 'same-name' }]);
  });

  it('compares names as spellings: case, spacing and accents aside', () => {
    expect(pairsOf([person('Zoë  Lark.md'), person('People/zoë lark.md')])).toHaveLength(1);
  });

  it('finds an alias of one that is the other’s name, but not a name only one starts with', () => {
    const mara = person('People/Mara Quill.md', { aliases: ['Mara'] });
    const short = person('Mara.md');
    const other = person('People/Mara Quillon.md');
    expect(find([mara, short, other]).map((pair) => pair.reasons)).toEqual([
      [{ kind: 'alias', alias: 'Mara' }],
    ]);
  });

  it('finds the same address on two notes, case aside', () => {
    const [pair] = find([
      person('A.md', { emails: ['Mara@larkspur.example.com'] }),
      person('B.md', { emails: ['mara@larkspur.example.com'] }),
    ]);
    expect(pair?.reasons).toEqual([{ kind: 'same-email', email: 'Mara@larkspur.example.com' }]);
  });

  it('finds the issue’s address variants of one person, and says how each pair matched', () => {
    const people = [
      person('Mara.md', { emails: ['mara@larkspur.example.com'] }),
      person('Mara Quill.md', { emails: ['mara.quill@larkspur.example.com'] }),
      person('Marra Quill.md', { emails: ['marra.quill@larkspur.example.com'] }),
    ];
    const found = find(people).map((pair) => [pair.left.name, pair.right.name, pair.reasons]);
    expect(found).toEqual([
      [
        'Mara Quill',
        'Mara',
        [
          {
            kind: 'similar-email',
            left: 'mara.quill@larkspur.example.com',
            right: 'mara@larkspur.example.com',
            local: 'first-name',
            sameDomain: true,
          },
        ],
      ],
      [
        'Mara Quill',
        'Marra Quill',
        [
          {
            kind: 'similar-email',
            left: 'mara.quill@larkspur.example.com',
            right: 'marra.quill@larkspur.example.com',
            local: 'typo',
            sameDomain: true,
          },
        ],
      ],
    ]);
  });

  it('compares addresses across a domain typo, and never across unrelated domains', () => {
    const people = [
      person('A.md', { emails: ['mara.quill@larkspur.example.com'] }),
      person('B.md', { emails: ['mara.quill@larkspor.example.com'] }),
      person('C.md', { emails: ['mara.quill@fenn.example'] }),
    ];
    expect(pairsOf(people)).toEqual(['A.md + B.md']);
  });

  it('puts the surest pairs first and keeps every reason a pair has, surest first', () => {
    const people = [
      person('Zed.md', { emails: ['zed@larkspur.example.com'] }),
      person('People/Zed.md', { emails: ['zed.fenn@larkspur.example.com'] }),
      person('Ann.md', { emails: ['ann.lark@larkspur.example.com'] }),
      person('Ann Lark.md', { emails: ['annlark@larkspur.example.com'] }),
    ];
    const found = find(people);
    expect(found.map((pair) => pair.reasons.map((reason) => reason.kind))).toEqual([
      ['same-name', 'similar-email'],
      ['similar-email'],
    ]);
  });

  it('never pairs a person with themself, however many addresses they have', () => {
    expect(
      pairsOf([
        person('Mara.md', {
          emails: ['mara@larkspur.example.com', 'mara.quill@larkspur.example.com'],
          aliases: ['Mara'],
        }),
      ]),
    ).toEqual([]);
  });

  it('leaves out a pair said not to be one person, either way round', () => {
    const people = [person('Tobias Fenn.md'), person('People/Tobias Fenn.md')];
    const dismissed = new Set([
      duplicatePairKey(createVaultPath('Tobias Fenn.md'), createVaultPath('People/Tobias Fenn.md')),
    ]);
    expect(pairsOf(people, dismissed)).toEqual([]);
  });

  it('ignores text in an address field that is not an address', () => {
    expect(
      pairsOf([person('A.md', { emails: ['mara'] }), person('B.md', { emails: ['mara'] })]),
    ).toEqual([]);
  });
});

describe('pairs remembered as not one person', () => {
  const left = createVaultPath('People/Tobias Fenn.md');
  const right = createVaultPath('Tobias Fenn.md');

  it('reads each pair of two paths, and nothing else under the key', () => {
    const read = dismissedDuplicates({
      [NOT_DUPLICATE_PEOPLE_KEY]: [[right, left], ['only one'], 'text', [left, left], [left, 3]],
    });
    expect([...read]).toEqual([duplicatePairKey(left, right)]);
    expect(dismissedDuplicates({ [NOT_DUPLICATE_PEOPLE_KEY]: 'nothing' }).size).toBe(0);
    expect(dismissedDuplicates({}).size).toBe(0);
  });

  it('keeps every pair already remembered when one more is', () => {
    const other = createVaultPath('Mara.md');
    const changes = dismissDuplicateChanges(
      { [NOT_DUPLICATE_PEOPLE_KEY]: [[right, left]] },
      { left: other, right },
    );
    expect(changes).toEqual({
      [NOT_DUPLICATE_PEOPLE_KEY]: [
        [left, right],
        [other, right],
      ],
    });
  });

  it('remembers a pair once, however often it is dismissed', () => {
    const changes = dismissDuplicateChanges(
      { [NOT_DUPLICATE_PEOPLE_KEY]: [[left, right]] },
      { left: right, right: left },
    );
    expect(changes[NOT_DUPLICATE_PEOPLE_KEY]).toEqual([[left, right]]);
  });
});

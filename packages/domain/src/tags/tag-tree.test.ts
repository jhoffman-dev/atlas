import { describe, expect, it } from 'vitest';
import { buildTagTree, findTagNode, type TagCount } from './tag-tree.ts';
import { rankTagSuggestions } from './tag-suggestions.ts';

const count = (name: string, uses: number): TagCount => ({
  key: name.toLowerCase(),
  name,
  count: uses,
});

describe('the tag tree', () => {
  it('nests a tag under each part before a /, even one never written alone', () => {
    const [para] = buildTagTree([count('para/resource', 2), count('para/area', 1)], 'name');
    expect(para).toMatchObject({ key: 'para', label: 'para', count: 0, total: 3 });
    expect(para?.children.map((child) => [child.label, child.name, child.total])).toEqual([
      ['area', 'para/area', 1],
      ['resource', 'para/resource', 2],
    ]);
  });

  it('adds a parent’s own uses to its children’s', () => {
    const [para] = buildTagTree([count('para', 4), count('para/x', 1)], 'name');
    expect(para).toMatchObject({ count: 4, total: 5 });
  });

  it('shows a tag the way it was first written', () => {
    const tree = buildTagTree([{ key: 'idea', name: 'Idea', count: 1 }], 'name');
    expect(tree[0]?.label).toBe('Idea');
  });

  it('sorts by name, ignoring case', () => {
    const tree = buildTagTree([count('beta', 9), count('Alpha', 1), count('gamma', 5)], 'name');
    expect(tree.map((node) => node.label)).toEqual(['Alpha', 'beta', 'gamma']);
  });

  it('sorts by frequency, most used first, then by name', () => {
    const tree = buildTagTree(
      [count('beta', 1), count('alpha', 1), count('gamma', 5), count('delta/x', 9)],
      'frequency',
    );
    expect(tree.map((node) => node.label)).toEqual(['delta', 'gamma', 'alpha', 'beta']);
  });

  it('sorts every level the same way', () => {
    const [root] = buildTagTree([count('r/b', 1), count('r/a', 7)], 'frequency');
    expect(root?.children.map((node) => node.label)).toEqual(['a', 'b']);
  });

  it('leaves out a tag nothing uses any more', () => {
    expect(buildTagTree([count('gone', 0)], 'name')).toEqual([]);
  });

  it('finds a node at any depth', () => {
    const tree = buildTagTree([count('a/b/c', 1)], 'name');
    expect(findTagNode(tree, 'a/b/c')?.label).toBe('c');
    expect(findTagNode(tree, 'a/b')?.total).toBe(1);
    expect(findTagNode(tree, 'nope')).toBeNull();
  });
});

describe('suggesting tags as # is typed', () => {
  const vault = [
    count('idea', 3),
    count('ideas', 9),
    count('para/resource', 5),
    count('reading', 1),
    count('Identity', 2),
  ];

  it('offers nothing before a letter, so a heading or a number is left alone', () => {
    expect(rankTagSuggestions('', vault)).toEqual([]);
    expect(rankTagSuggestions('1', vault)).toEqual([]);
    expect(rankTagSuggestions(' ', vault)).toEqual([]);
  });

  it('offers what was typed first, to create, then tags starting with it, most used first', () => {
    expect(rankTagSuggestions('ID', vault).map((item) => item.name)).toEqual([
      'ID',
      'ideas',
      'idea',
      'Identity',
    ]);
  });

  it('offers the tag typed exactly first, above longer tags that are used more', () => {
    // Enter picks the first item: typing `#idea` must not turn into `#ideas`.
    expect(rankTagSuggestions('idea', vault).map((item) => item.name)).toEqual(['idea', 'ideas']);
    expect(rankTagSuggestions('IDEA', vault)[0]).toEqual({
      kind: 'existing',
      name: 'idea',
      count: 3,
    });
  });

  it('offers a nested tag by any of its parts, after the direct matches', () => {
    expect(rankTagSuggestions('re', vault).map((item) => item.name)).toEqual([
      're',
      'reading',
      'para/resource',
    ]);
  });

  it('offers to create a tag that is not in use yet', () => {
    expect(rankTagSuggestions('brandnew', vault)).toEqual([{ kind: 'create', name: 'brandnew' }]);
  });

  it('does not offer to create a tag that already exists', () => {
    expect(rankTagSuggestions('Idea', vault).some((item) => item.kind === 'create')).toBe(false);
  });

  it('does not offer to create a name that cannot be a tag', () => {
    expect(rankTagSuggestions('para/', vault)).toEqual([
      { kind: 'existing', name: 'para/resource', count: 5 },
    ]);
  });

  it('carries each tag’s count, for showing beside it', () => {
    expect(rankTagSuggestions('read', vault).find((item) => item.name === 'reading')).toEqual({
      kind: 'existing',
      name: 'reading',
      count: 1,
    });
  });

  it('offers at most eight, never leaving out the tag typed', () => {
    const many = Array.from({ length: 20 }, (_, at) => count(`tag${at}`, at + 10));
    const created = rankTagSuggestions('tag', many);
    expect(created).toHaveLength(8);
    expect(created[0]).toEqual({ kind: 'create', name: 'tag' });
    expect(created[1]?.name).toBe('tag19');

    const exact = rankTagSuggestions('tag1', many);
    expect(exact).toHaveLength(8);
    expect(exact[0]?.name).toBe('tag1');
  });

  it('does not offer to create a name that starts or ends with _', () => {
    expect(rankTagSuggestions('draft_', vault)).toEqual([]);
  });
});

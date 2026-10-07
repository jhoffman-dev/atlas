import { describe, expect, it } from 'vitest';
import {
  frontmatterTagNames,
  noteTags,
  renameTagInBody,
  renameTagInProperty,
  tagsInBody,
} from './note-tags.ts';

/** The whole body as one run of text. */
const all = (body: string) => [{ start: 0, end: body.length }];

describe('tags in a body', () => {
  it('reads only the runs of text it is given, so code and links are never read', () => {
    const body = '#one `#code` #two';
    // As the parser would hand them over: the code span is not text.
    const ranges = [
      { start: 0, end: 5 },
      { start: 12, end: 17 },
    ];
    expect(tagsInBody({ body, ranges }).map((tag) => tag.name)).toEqual(['one', 'two']);
  });

  it('reports offsets in the body, not in the run', () => {
    const body = 'abc #tag';
    expect(tagsInBody({ body, ranges: [{ start: 3, end: 8 }] })).toEqual([
      { start: 4, end: 8, name: 'tag', closed: false },
    ]);
  });

  it('reads the runs in body order whatever order they come in', () => {
    const body = '#a #b';
    const ranges = [
      { start: 3, end: 5 },
      { start: 0, end: 2 },
    ];
    expect(tagsInBody({ body, ranges }).map((tag) => tag.name)).toEqual(['a', 'b']);
  });
});

describe('tags in frontmatter', () => {
  it.each([
    [
      ['idea', 'para/resource'],
      ['idea', 'para/resource'],
    ],
    [
      ['#idea', '#tag me#'],
      ['idea', 'tag me'],
    ],
    ['idea, other', ['idea', 'other']],
    ['idea', ['idea']],
    [['idea', 42, null, '', '123', 'bad//name'], ['idea']],
    [null, []],
    [42, []],
    [{ nested: 'idea' }, []],
  ])('%j gives %j', (value, expected) => {
    expect(frontmatterTagNames(value)).toEqual(expected);
  });
});

describe('every tag of a note', () => {
  it('lists the property’s tags, then the body’s, keyed without case', () => {
    const body = 'text #Idea';
    expect(noteTags({ tagsProperty: ['Project'], body, ranges: all(body) })).toEqual([
      { key: 'project', name: 'Project' },
      { key: 'idea', name: 'Idea' },
    ]);
  });

  it('counts each use, so a tag used twice is there twice', () => {
    const body = '#a and #A';
    expect(noteTags({ tagsProperty: undefined, body, ranges: all(body) })).toHaveLength(2);
  });
});

describe('renaming a tag in a body', () => {
  const rename = (body: string, from: string, to: string) =>
    renameTagInBody({ body, ranges: all(body), rename: { from, to } });

  it('changes only the tag’s bytes', () => {
    expect(rename('Keep  this #idea, and  this.\n', 'idea', 'thought')).toEqual({
      body: 'Keep  this #thought, and  this.\n',
      count: 1,
      problem: null,
    });
  });

  it('renames every use, whatever its case', () => {
    expect(rename('#idea #IDEA #Idea', 'idea', 'x').body).toBe('#x #x #x');
  });

  it('carries nested tags along', () => {
    expect(rename('#para #para/resource #para/Area/x', 'para', 'area')).toEqual({
      body: '#area #area/resource #area/Area/x',
      count: 3,
      problem: null,
    });
  });

  it('leaves tags that only share the first letters', () => {
    expect(rename('#paragraph #para', 'para', 'x').body).toBe('#paragraph #x');
  });

  it('closes a tag that gains a space', () => {
    expect(rename('see #idea here', 'idea', 'big idea').body).toBe('see #big idea# here');
  });

  it('keeps a closed tag closed', () => {
    expect(rename('#tag me# and', 'tag me', 'other').body).toBe('#other# and');
  });

  it('leaves text outside the runs it is given', () => {
    const body = '`#idea` #idea';
    expect(
      renameTagInBody({ body, ranges: [{ start: 7, end: 13 }], rename: { from: 'idea', to: 'x' } }),
    ).toEqual({ body: '`#idea` #x', count: 1, problem: null });
  });

  it('counts nothing when the tag is not there', () => {
    expect(rename('#other', 'idea', 'x')).toEqual({ body: '#other', count: 0, problem: null });
  });

  it('counts only the uses it changes, so evening out the spelling skips those written so', () => {
    expect(rename('#Idea #idea #Idea/x', 'Idea', 'Idea')).toEqual({
      body: '#Idea #Idea #Idea/x',
      count: 1,
      problem: null,
    });
  });
});

describe('renaming a tag in the tags property', () => {
  const rename = { from: 'idea', to: 'thought' };

  it('keeps a list a list, and its other items as they were', () => {
    expect(renameTagInProperty(['a', 'Idea', 'b'], rename)).toEqual({
      value: ['a', 'thought', 'b'],
      count: 1,
    });
  });

  it('keeps an item’s # and closes it when it gains a space', () => {
    expect(renameTagInProperty(['#idea'], rename)?.value).toEqual(['#thought']);
    expect(renameTagInProperty(['#idea'], { from: 'idea', to: 'big idea' })?.value).toEqual([
      '#big idea#',
    ]);
    expect(renameTagInProperty(['#tag me#'], { from: 'tag me', to: 'x' })?.value).toEqual(['#x#']);
  });

  it('keeps a comma-separated string a string, spacing and all', () => {
    expect(renameTagInProperty('a,  idea , b', rename)).toEqual({
      value: 'a,  thought , b',
      count: 1,
    });
  });

  it('carries nested tags along', () => {
    expect(renameTagInProperty(['idea/one', 'idea'], rename)?.value).toEqual([
      'thought/one',
      'thought',
    ]);
  });

  it('keeps one when renaming into a tag the note already has', () => {
    expect(renameTagInProperty(['thought', 'idea', 'x'], rename)).toEqual({
      value: ['thought', 'x'],
      count: 1,
    });
  });

  it('keeps the renamed item when the note has it twice in other spellings', () => {
    expect(renameTagInProperty(['idea', 'thought'], rename)).toEqual({
      value: ['thought'],
      count: 1,
    });
  });

  it('leaves items it does not rename, duplicates included', () => {
    expect(renameTagInProperty(['a', 'A', 'idea'], rename)?.value).toEqual(['a', 'A', 'thought']);
  });

  it('counts only the items it changes, and is null when every one is already so', () => {
    expect(renameTagInProperty(['Idea', 'idea'], { from: 'Idea', to: 'Idea' })).toEqual({
      value: ['Idea'],
      count: 1,
    });
    expect(renameTagInProperty(['Idea'], { from: 'Idea', to: 'Idea' })).toBeNull();
  });

  it('leaves items that are not tags alone', () => {
    expect(renameTagInProperty([42, 'idea'], rename)?.value).toEqual([42, 'thought']);
  });

  it('is null when nothing changes', () => {
    expect(renameTagInProperty(['other'], rename)).toBeNull();
    expect(renameTagInProperty(undefined, rename)).toBeNull();
  });
});

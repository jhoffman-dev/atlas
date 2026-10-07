import { describe, expect, it } from 'vitest';
import {
  formatTag,
  isTagName,
  isTagWithin,
  renamedTagName,
  tagKey,
  tagNameFromInput,
  tagRenameProblem,
} from './tag-name.ts';

describe('a new name typed for a tag', () => {
  it('drops the # it may be typed with', () => {
    expect(tagNameFromInput(' #idea ')).toBe('idea');
    expect(tagNameFromInput('#tag me#')).toBe('tag me');
    expect(tagNameFromInput('plain')).toBe('plain');
  });

  it('must be a name a tag can have', () => {
    expect(tagRenameProblem({ from: 'a', to: '' })).toMatch(/name/);
    expect(tagRenameProblem({ from: 'a', to: '123' })).toMatch(/letter/);
    expect(tagRenameProblem({ from: 'a', to: 'a//b' })).toMatch(/nested/);
  });

  it('may be the name it has, so every use can be written the way it is shown', () => {
    expect(tagRenameProblem({ from: 'Idea', to: 'Idea' })).toBeNull();
    expect(tagRenameProblem({ from: 'idea', to: 'Idea' })).toBeNull();
    expect(tagRenameProblem({ from: 'idea', to: 'para/idea' })).toBeNull();
  });

  it('may not start or end with _, which markdown reads as emphasis', () => {
    for (const to of ['_draft_', '_draft', 'draft_', 'a/_b', 'tag me_']) {
      expect(tagRenameProblem({ from: 'idea', to })).toMatch(/start or end with _/);
    }
    expect(tagRenameProblem({ from: 'idea', to: 'my_draft' })).toBeNull();
  });

  it('may not put the tag inside itself', () => {
    expect(tagRenameProblem({ from: 'a', to: 'a/b' })).toMatch(/inside itself/);
    expect(tagRenameProblem({ from: 'Para', to: 'para/x/y' })).toMatch(/inside itself/);
    expect(tagRenameProblem({ from: 'a/b', to: 'a' })).toBeNull();
    expect(tagRenameProblem({ from: 'a', to: 'ab/c' })).toBeNull();
  });
});

describe('a tag’s identity', () => {
  it('ignores case, so #Idea and #idea are one tag', () => {
    expect(tagKey('Idea')).toBe(tagKey('idea'));
    expect(tagKey('Para/Resource')).toBe('para/resource');
  });

  it('ignores how an accented letter is encoded', () => {
    expect(tagKey('café')).toBe(tagKey('café'));
  });

  it('counts a run of spaces as one', () => {
    expect(tagKey('tag  me')).toBe('tag me');
  });

  it('keeps different words different', () => {
    expect(tagKey('idea')).not.toBe(tagKey('ideas'));
  });
});

describe('which names can be tags', () => {
  it.each(['idea', 'para/resource', 'tag me', 'a/b c/d', 'v2', '日本', 'x_y-z'])(
    '%j can',
    (name) => {
      expect(isTagName(name)).toBe(true);
    },
  );

  it.each([
    '',
    '123',
    'a/',
    '/a',
    'a//b',
    ' a',
    'a ',
    'a  b',
    'a,b',
    '-a',
    'a#b',
    'a/ b',
    '_a',
    'a_',
    'a/_b',
    'a b_',
  ])('%j cannot', (name) => {
    expect(isTagName(name)).toBe(false);
  });
});

describe('writing a tag', () => {
  it('writes a single word with one #', () => {
    expect(formatTag('idea')).toBe('#idea');
  });

  it('closes a name with a space, or it would not read back whole', () => {
    expect(formatTag('tag me')).toBe('#tag me#');
  });

  it('keeps a closed single word closed', () => {
    expect(formatTag('idea', true)).toBe('#idea#');
  });
});

describe('nesting', () => {
  it('counts a tag as within itself and its ancestors, not a sibling that shares letters', () => {
    expect(isTagWithin('para', 'para')).toBe(true);
    expect(isTagWithin('para/resource', 'para')).toBe(true);
    expect(isTagWithin('paragraph', 'para')).toBe(false);
    expect(isTagWithin('para', 'para/resource')).toBe(false);
  });
});

describe('renaming', () => {
  it('renames the tag itself', () => {
    expect(renamedTagName({ name: 'idea', from: 'idea', to: 'thought' })).toBe('thought');
  });

  it('renames whatever case it was written in', () => {
    expect(renamedTagName({ name: 'IDEA', from: 'idea', to: 'thought' })).toBe('thought');
  });

  it('carries nested tags along, keeping the rest of their name as written', () => {
    expect(renamedTagName({ name: 'Para/Resource', from: 'para', to: 'Area' })).toBe(
      'Area/Resource',
    );
  });

  it('can move a tag under another', () => {
    expect(renamedTagName({ name: 'a/b', from: 'a', to: 'x/y' })).toBe('x/y/b');
  });

  it('leaves a tag that only starts with the same letters', () => {
    expect(renamedTagName({ name: 'paragraph', from: 'para', to: 'x' })).toBeNull();
  });

  it('leaves a parent of the renamed tag', () => {
    expect(renamedTagName({ name: 'para', from: 'para/resource', to: 'x' })).toBeNull();
  });
});

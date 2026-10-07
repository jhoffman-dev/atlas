import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  artifactKind,
  artifactPlacement,
  artifactProperties,
  artifactSlug,
  artifactTags,
  claudeArtifactUrl,
  copyFolderFor,
  isArtifactKind,
  isArtifactLink,
  isArtifactNote,
  kindFromHtml,
  kindFromUrl,
  pastedArtifactCommands,
  projectLink,
  SAVE_ARTIFACT_LINK,
  savedCopyValues,
  savedFolderOf,
} from './artifact.ts';

describe('claudeArtifactUrl', () => {
  it.each([
    'https://claude.ai/artifact/abc123',
    'https://claude.ai/code/artifact/0f6c1f1e-1111-4222-8333-944445555666',
    'https://claude.ai/public/artifacts/xyz',
    'https://www.claude.ai/artifact/abc',
    'https://claude.site/artifacts/abc',
    '  https://claude.ai/artifact/abc  ',
  ])('recognises %s', (text) => {
    expect(claudeArtifactUrl(text)).toBe(new URL(text.trim()).href);
  });

  it.each([
    ['plain http', 'http://claude.ai/artifact/abc'],
    ['another host', 'https://example.com/artifact/abc'],
    ['a host that only ends in the name', 'https://notclaude.ai/artifact/abc'],
    ['no id after the segment', 'https://claude.ai/artifact/'],
    ['a chat, not an artifact', 'https://claude.ai/chat/abc'],
    ['not an address', 'save this artifact'],
    ['empty', ''],
  ])('refuses %s', (_why, text) => {
    expect(claudeArtifactUrl(text)).toBeNull();
  });
});

describe('isArtifactLink', () => {
  it('keeps http and https addresses', () => {
    expect(isArtifactLink('https://example.com/x')).toBe(true);
    expect(isArtifactLink('http://localhost:3000')).toBe(true);
  });

  it('refuses other schemes and non-addresses', () => {
    expect(isArtifactLink('javascript:alert(1)')).toBe(false);
    expect(isArtifactLink('file:///etc/passwd')).toBe(false);
    expect(isArtifactLink('not a link')).toBe(false);
  });
});

describe('kind guessing', () => {
  it('reads a kind from the words in a link', () => {
    expect(kindFromUrl('https://claude.ai/artifact/q3-sales-deck')).toBe('deck');
    expect(kindFromUrl('https://x.dev/slides/1')).toBe('deck');
    expect(kindFromUrl('https://x.dev/design_system')).toBe('design');
    expect(kindFromUrl('https://x.dev/docs/intro')).toBe('doc');
    expect(kindFromUrl('https://claude.ai/artifact/abc')).toBeNull();
    expect(kindFromUrl('nonsense')).toBeNull();
  });

  it('reads a deck from reveal.js or three slides', () => {
    expect(kindFromHtml('<script src="reveal.min.js"></script>')).toBe('deck');
    const slides = '<section class="slide"></section>'.repeat(3);
    expect(kindFromHtml(slides)).toBe('deck');
    expect(kindFromHtml('<section class="slide"></section>'.repeat(2))).toBe('page');
  });

  it('reads a design from artboards, and a doc from an article or long prose', () => {
    expect(kindFromHtml('<div class="frame artboard"></div>')).toBe('design');
    expect(kindFromHtml('<article><p>Hi</p></article>')).toBe('doc');
    const prose = '<h2>A</h2><h2>B</h2><h2>C</h2>' + '<p>text</p>'.repeat(8);
    expect(kindFromHtml(prose)).toBe('doc');
    expect(kindFromHtml('<h2>A</h2><h2>B</h2><h2>C</h2><p>short</p>')).toBe('page');
  });

  it('takes the kind asked for, then the HTML, then the link, then page', () => {
    expect(artifactKind({ asked: 'design', html: '<article>' })).toBe('design');
    expect(artifactKind({ asked: 'bogus', html: '<article>' })).toBe('doc');
    expect(artifactKind({ url: 'https://x.dev/slides/a' })).toBe('deck');
    expect(artifactKind({ url: 'https://claude.ai/artifact/a' })).toBe('page');
    expect(artifactKind({})).toBe('page');
  });

  it('knows its kinds', () => {
    expect(isArtifactKind('other')).toBe(true);
    expect(isArtifactKind('slides')).toBe(false);
    expect(isArtifactKind(3)).toBe(false);
  });
});

describe('artifactSlug', () => {
  it('lower-cases, hyphenates and drops accents', () => {
    expect(artifactSlug('Café Menu — Q3 2026!')).toBe('cafe-menu-q3-2026');
  });

  it('is never empty nor hidden', () => {
    expect(artifactSlug('!!!')).toBe('artifact');
    expect(artifactSlug('.env')).toBe('env');
  });

  it('is at most sixty characters and does not end in a hyphen', () => {
    const slug = artifactSlug(`${'a'.repeat(59)} b`);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('artifactPlacement', () => {
  it('puts the note and its copy in artifacts/', () => {
    expect(artifactPlacement({ title: 'Sales Deck', taken: new Set() })).toEqual({
      notePath: 'artifacts/Sales Deck.md',
      copyFolder: 'artifacts/sales-deck',
    });
  });

  it('numbers both together when either is taken, in any case', () => {
    expect(
      artifactPlacement({ title: 'Sales Deck', taken: new Set(['artifacts/SALES-DECK']) }),
    ).toEqual({ notePath: 'artifacts/Sales Deck 2.md', copyFolder: 'artifacts/sales-deck-2' });
    expect(
      artifactPlacement({
        title: 'Sales Deck',
        taken: new Set(['artifacts/sales deck.md', 'artifacts/Sales Deck 2.md']),
      }),
    ).toEqual({ notePath: 'artifacts/Sales Deck 3.md', copyFolder: 'artifacts/sales-deck-3' });
  });

  it('names an unnamed artifact, and cleans a name no disk accepts', () => {
    expect(artifactPlacement({ title: '  ', taken: new Set() }).notePath).toBe(
      'artifacts/Untitled artifact.md',
    );
    expect(artifactPlacement({ title: 'a/b:c', taken: new Set() }).notePath).toBe(
      'artifacts/a b c.md',
    );
  });

  it('gives up rather than looping forever', () => {
    const taken = new Set(
      Array.from({ length: 1001 }, (_, at) => `artifacts/x${at === 0 ? '' : ` ${at + 1}`}.md`),
    );
    expect(() => artifactPlacement({ title: 'x', taken })).toThrow(/No free name/);
  });

  it('finds the copy folder from any note', () => {
    expect(copyFolderFor(createVaultPath('Work/My Page.md'))).toBe('Work/my-page');
    expect(copyFolderFor(createVaultPath('Top.md'))).toBe('top');
  });
});

describe('properties', () => {
  it('writes only what there is, type first, in the type’s order', () => {
    const properties = artifactProperties({
      url: ' https://claude.ai/artifact/a ',
      kind: 'deck',
      project: 'Atlas',
      tags: ['#q3', 'sales', ' ', 'sales'],
      copy: { saved: createVaultPath('artifacts/a'), savedAt: '2026-09-25' },
    });
    expect(Object.keys(properties)).toEqual([
      'type',
      'url',
      'kind',
      'project',
      'tags',
      'saved',
      'saved_at',
    ]);
    expect(properties).toMatchObject({
      type: 'artifact',
      url: 'https://claude.ai/artifact/a',
      project: '[[Atlas]]',
      tags: ['q3', 'sales'],
    });
  });

  it('leaves out an empty link, project, tags and copy', () => {
    expect(
      artifactProperties({ url: '', kind: 'page', project: ' ', tags: [], copy: null }),
    ).toEqual({ type: 'artifact', kind: 'page' });
  });

  it('records a copy as saved and saved_at alone: the cover is left to its thumbnail', () => {
    expect(
      savedCopyValues({ saved: createVaultPath('artifacts/a'), savedAt: '2026-09-25' }),
    ).toEqual({ saved: 'artifacts/a', saved_at: '2026-09-25' });
  });

  it('links a project whether or not it came bracketed', () => {
    expect(projectLink('[[Atlas]]')).toBe('[[Atlas]]');
    expect(projectLink(' Atlas ')).toBe('[[Atlas]]');
    expect(projectLink('[[ ]]')).toBe('');
  });

  it('cleans tags', () => {
    expect(artifactTags(['##a', 'a', ' b '])).toEqual(['a', 'b']);
  });

  it('reads the copy folder and whether a note is an artifact', () => {
    expect(savedFolderOf({ saved: ' artifacts/a ' })).toBe('artifacts/a');
    expect(savedFolderOf({ saved: '' })).toBeNull();
    expect(savedFolderOf({ saved: 3 })).toBeNull();
    expect(isArtifactNote({ type: 'artifact' })).toBe(true);
    expect(isArtifactNote({ type: 'task' })).toBe(false);
  });
});

describe('pastedArtifactCommands', () => {
  it('offers to save a pasted artifact link, and nothing for other text', () => {
    expect(pastedArtifactCommands('https://claude.ai/artifact/abc')).toEqual([
      { id: SAVE_ARTIFACT_LINK, label: 'Save this link as an artifact' },
    ]);
    expect(pastedArtifactCommands('artifact')).toEqual([]);
  });
});

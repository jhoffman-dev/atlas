import { describe, expect, it } from 'vitest';
import {
  MAX_ARTIFACT_FILE_BYTES,
  MAX_ARTIFACT_FILES,
  artifactCopyPlan,
  artifactFileRefusal,
  artifactMediaType,
  isArtifactPage,
  isArtifactTextFile,
  type ArtifactFileInput,
} from './artifact-files.ts';

const file = (name: string, size = 1): ArtifactFileInput => ({ name, bytes: new Uint8Array(size) });

describe('artifactFileRefusal', () => {
  it.each(['index.html', 'app.css', 'js/app.js', 'data.json', 'a/b/c/logo.PNG', 'font.woff2'])(
    'allows %s',
    (name) => {
      expect(artifactFileRefusal(name)).toBeNull();
    },
  );

  it.each([
    ['empty', ''],
    ['absolute', '/etc/passwd.html'],
    ['a parent escape', '../secrets.html'],
    ['an escape in the middle', 'a/../../b.html'],
    ['a dot segment', './index.html'],
    ['an empty segment', 'a//b.html'],
    ['a backslash', '..\\evil.html'],
    ['a control character', 'a\u0000.html'],
    ['a hidden file', '.env.json'],
    ['a hidden folder', '.git/config.json'],
    ['too deep', 'a/b/c/d/e.png'],
    ['markdown, which would be a note', 'README.md'],
    ['no extension', 'Makefile'],
    ['an executable', 'run.sh'],
    ['a name too long', `${'a'.repeat(200)}.html`],
  ])('refuses %s', (_why, name) => {
    expect(artifactFileRefusal(name)).not.toBeNull();
  });
});

describe('what a file is', () => {
  it('knows media types, text and pages', () => {
    expect(artifactMediaType('a.JPG')).toBe('image/jpeg');
    expect(artifactMediaType('a.svg')).toBe('image/svg+xml');
    expect(artifactMediaType('a.exe')).toBe('application/octet-stream');
    expect(isArtifactTextFile('a.css')).toBe(true);
    expect(isArtifactTextFile('a.png')).toBe(false);
    expect(isArtifactPage('a.htm')).toBe(true);
    expect(isArtifactPage('.html')).toBe(false);
  });
});

describe('artifactCopyPlan', () => {
  it('keeps a copy that already opens on index.html', () => {
    const plan = artifactCopyPlan([file('index.html'), file('app.css')]);
    expect(plan?.files.map((f) => f.name)).toEqual(['index.html', 'app.css']);
    expect(plan?.skipped).toEqual([]);
  });

  it('makes the only page at the top index.html', () => {
    const plan = artifactCopyPlan([file('Dashboard.html'), file('app.js')]);
    expect(plan?.files.map((f) => f.name)).toEqual(['index.html', 'app.js']);
  });

  it('takes off the one folder a picked folder shares', () => {
    const plan = artifactCopyPlan([file('site/index.html'), file('site/css/app.css')]);
    expect(plan?.files.map((f) => f.name)).toEqual(['index.html', 'css/app.css']);
  });

  it('keeps the folders when files come from more than one', () => {
    const plan = artifactCopyPlan([file('index.html'), file('css/app.css')]);
    expect(plan?.files.map((f) => f.name)).toEqual(['index.html', 'css/app.css']);
  });

  it('skips what a copy cannot hold, and says why', () => {
    const plan = artifactCopyPlan([
      file('index.html'),
      file('.DS_Store'),
      file('notes.md'),
      file('big.png', MAX_ARTIFACT_FILE_BYTES + 1),
    ]);
    expect(plan?.files.map((f) => f.name)).toEqual(['index.html']);
    expect(plan?.skipped.map((s) => s.name)).toEqual(['.DS_Store', 'notes.md', 'big.png']);
    expect(plan?.skipped[2]?.reason).toMatch(/32 MB/);
  });

  it('stops at the most files a copy holds', () => {
    const many = Array.from({ length: MAX_ARTIFACT_FILES + 2 }, (_, at) => file(`f${at}.css`));
    const plan = artifactCopyPlan([file('index.html'), ...many]);
    expect(plan?.files).toHaveLength(MAX_ARTIFACT_FILES);
    expect(plan?.skipped).toHaveLength(3);
  });

  it('has nothing to open without exactly one page to choose', () => {
    expect(artifactCopyPlan([file('app.css')])).toBeNull();
    expect(artifactCopyPlan([file('a.html'), file('b.html')])).toBeNull();
    expect(artifactCopyPlan([file('pages/a.html')])).not.toBeNull();
    expect(artifactCopyPlan([])).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_CSP,
  inlineArtifactPage,
  pageReferences,
  resolveArtifactReference,
  stylesheetReferences,
  withArtifactCsp,
  type InlineFile,
} from './artifact-inline.ts';

const META = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`;

describe('resolveArtifactReference', () => {
  it('resolves against the folder of the file that names it', () => {
    expect(resolveArtifactReference({ from: 'index.html', ref: 'app.css' })).toBe('app.css');
    expect(resolveArtifactReference({ from: 'css/app.css', ref: '../img/a.png' })).toBe(
      'img/a.png',
    );
    expect(resolveArtifactReference({ from: 'css/app.css', ref: './f.woff2?v=2#x' })).toBe(
      'css/f.woff2',
    );
    expect(resolveArtifactReference({ from: 'css/app.css', ref: '/logo.png' })).toBe('logo.png');
    expect(resolveArtifactReference({ from: 'index.html', ref: 'my%20pic.png' })).toBe(
      'my pic.png',
    );
    expect(resolveArtifactReference({ from: 'index.html', ref: '100%.png' })).toBe('100%.png');
  });

  it.each([
    ['another site', 'https://cdn.example/x.js'],
    ['a protocol-relative address', '//cdn.example/x.js'],
    ['a data URL', 'data:image/png;base64,AAAA'],
    ['script in a link', 'javascript:alert(1)'],
    ['an anchor', '#top'],
    ['a climb out of the copy', '../../etc/passwd.css'],
    ['a file a copy cannot hold', 'notes.md'],
    ['nothing', '  '],
  ])('refuses %s', (_why, ref) => {
    expect(resolveArtifactReference({ from: 'index.html', ref })).toBeNull();
  });
});

describe('references', () => {
  it('finds stylesheets, scripts, pictures and CSS urls in the page, once each', () => {
    const html = `
      <link rel="stylesheet" href="app.css"><link rel="preconnect" href="https://x.dev">
      <script src="js/app.js"></script><script>inline()</script>
      <img src='pic.png'><img src=pic.png>
      <div style="background: url(bg.webp)"></div>`;
    expect(pageReferences(html, 'index.html')).toEqual([
      'app.css',
      'js/app.js',
      'pic.png',
      'bg.webp',
    ]);
  });

  it('finds what a stylesheet names, relative to it', () => {
    const css = `@font-face { src: url("../fonts/a.woff2") } .x { background: url('b.png') }`;
    expect(stylesheetReferences(css, 'css/app.css')).toEqual(['fonts/a.woff2', 'css/b.png']);
  });
});

describe('inlineArtifactPage', () => {
  const files = new Map<string, InlineFile>([
    ['css/app.css', { text: '.hero{background:url(../img/bg.png)} </style><b>' }],
    ['js/app.js', { text: 'document.title = "</script>";' }],
    ['img/bg.png', { dataUrl: 'data:image/png;base64,QkE=' }],
    ['img/pic.png', { dataUrl: 'data:image/png;base64,UElD' }],
    ['favicon.png', { dataUrl: 'data:image/png;base64,Rkk=' }],
  ]);

  const page = `<!doctype html><html><head><link rel="stylesheet" href="css/app.css"><link rel="icon" href="favicon.png"></head>
<body><script type="module" src="js/app.js"></script><img alt="x" src="img/pic.png">
<p style="background:url('img/bg.png')">hi</p><style>.a{background:url(img/pic.png)}</style>
<img src="https://example.com/remote.png"><script src="missing.js"></script></body></html>`;

  const out = inlineArtifactPage({ html: page, from: 'index.html', files });

  it('writes a stylesheet in as a style, its urls as data, unable to end the style early', () => {
    expect(out).toContain(
      '<style>.hero{background:url(data:image/png;base64,QkE=)} <\\/style><b></style>',
    );
    expect(out).not.toContain('href="css/app.css"');
  });

  it("writes a script's file in as its body, keeping its other attributes", () => {
    expect(out).toContain('<script type="module">document.title = "<\\/script>";</script>');
  });

  it('writes pictures in as data, in tags, style attributes and style blocks', () => {
    expect(out).toContain('<img alt="x" src="data:image/png;base64,UElD">');
    expect(out).toContain(`style="background:url(data:image/png;base64,QkE=)"`);
    expect(out).toContain('.a{background:url(data:image/png;base64,UElD)}');
    expect(out).toContain('<link rel="icon" href="data:image/png;base64,Rkk=">');
  });

  it('leaves alone what the copy does not hold', () => {
    expect(out).toContain('<img src="https://example.com/remote.png">');
    expect(out).toContain('<script src="missing.js"></script>');
  });

  it('puts the policy first, straight after the doctype', () => {
    expect(out.startsWith(`<!doctype html>${META}<html><head><style>`)).toBe(true);
  });

  it('keeps a script that has a body of its own as it is', () => {
    const html = '<script src="js/app.js">fallback()</script>';
    expect(inlineArtifactPage({ html, from: 'index.html', files })).toContain(html);
  });

  it('does not put text where a picture belongs', () => {
    const html = '<img src="js/app.js">';
    expect(inlineArtifactPage({ html, from: 'index.html', files })).toContain(html);
  });
});

describe('withArtifactCsp', () => {
  it('goes after a leading doctype, else first — never after a <head> it searched for', () => {
    expect(withArtifactCsp('<head lang="en"><title>')).toBe(`${META}<head lang="en"><title>`);
    expect(withArtifactCsp('<html><body>')).toBe(`${META}<html><body>`);
    expect(withArtifactCsp('<!DOCTYPE html><p>')).toBe(`<!DOCTYPE html>${META}<p>`);
    expect(withArtifactCsp(' <!-- c --> <!doctype html><p>')).toBe(
      ` <!-- c --> <!doctype html>${META}<p>`,
    );
    expect(withArtifactCsp('<p>hi</p><!doctype html>')).toBe(`${META}<p>hi</p><!doctype html>`);
    expect(withArtifactCsp('<p>hi</p>')).toBe(`${META}<p>hi</p>`);
  });

  it('drops a leading byte-order mark so the doctype is still first', () => {
    expect(withArtifactCsp('﻿<!doctype html><p>')).toBe(`<!doctype html>${META}<p>`);
  });

  it('allows no fetch, no frames, no forms and no remote pictures', () => {
    expect(ARTIFACT_CSP).toContain("default-src 'none'");
    expect(ARTIFACT_CSP).toContain("connect-src 'none'");
    expect(ARTIFACT_CSP).toContain("frame-src 'none'");
    expect(ARTIFACT_CSP).toContain("form-action 'none'");
    expect(ARTIFACT_CSP).toContain('img-src data: blob:;');
    expect(ARTIFACT_CSP).not.toContain('unsafe-eval');
  });
});

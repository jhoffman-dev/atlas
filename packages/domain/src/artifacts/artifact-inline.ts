import { artifactFileRefusal } from './artifact-files.ts';

/*
 * A saved copy, made into one document a sandboxed frame can show.
 *
 * The frame runs with an opaque origin and no access to the app, so it cannot
 * fetch `app.css` from the vault the way a browser would fetch it from a
 * server. Instead every file the page names — stylesheets, scripts, images,
 * fonts named by the stylesheets — is written into the page itself: CSS and
 * JavaScript inline, pictures and fonts as `data:` URLs. A reference to
 * anything that is not in the copy is left as it is, and the frame's policy
 * decides whether it loads.
 */

/** What a file in the copy is, once read, for writing into the page. */
export type InlineFile = { readonly text: string } | { readonly dataUrl: string };

/**
 * The policy the page is shown under, set by a `<meta>` Atlas puts first in
 * its head: a page's own policy can only narrow this, never widen it.
 *
 * Nothing is fetched but scripts, styles and fonts from the two CDNs and the
 * font service that Claude's own artifacts are allowed; no `fetch`, no frames,
 * no forms, no `<base>`. Pictures only from the page itself (`data:`, `blob:`),
 * so a picture cannot be a beacon.
 */
export const ARTIFACT_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
  "style-src 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
  'font-src data: https://fonts.gstatic.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net',
  'img-src data: blob:',
  'media-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Where a reference in `from` points inside the copy, or null when it points
 * outside it: another site, a `data:` URL, an anchor, or a path that climbs
 * out of the copy's folder or names a file a copy cannot hold.
 */
export function resolveArtifactReference({
  from,
  ref,
}: {
  from: string;
  ref: string;
}): string | null {
  const wanted = (ref.trim().split(/[?#]/)[0] ?? '').trim();
  if (wanted === '' || wanted.startsWith('//') || SCHEME.test(wanted)) return null;

  const base = wanted.startsWith('/') ? [] : from.split('/').slice(0, -1);
  const segments: string[] = [...base];
  for (const segment of decoded(wanted).split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment !== '..') segments.push(segment);
    else if (segments.pop() === undefined) return null;
  }
  const path = segments.join('/');
  return artifactFileRefusal(path) === null ? path : null;
}

function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    // Not percent-encoded after all: the name is taken as written.
    return text;
  }
}

const LINK_TAG = /<link\b[^>]*>/gi;
const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const MEDIA_TAG = /<(?:img|source|video|audio|input)\b[^>]*>/gi;
const CSS_URL = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi;

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return match === null ? null : (match[1] ?? match[2] ?? match[3] ?? '');
}

function isStylesheet(tag: string): boolean {
  return /\bstylesheet\b/i.test(attribute(tag, 'rel') ?? '');
}

/** Every file in the copy the page names directly, in the order it names them. */
export function pageReferences(html: string, from: string): string[] {
  const refs: (string | null)[] = [];
  for (const tag of html.match(LINK_TAG) ?? []) refs.push(attribute(tag, 'href'));
  for (const [, attrs = ''] of html.matchAll(SCRIPT_TAG)) refs.push(attribute(` ${attrs}`, 'src'));
  for (const tag of html.match(MEDIA_TAG) ?? []) refs.push(attribute(tag, 'src'));
  for (const [, , ref] of html.matchAll(CSS_URL)) refs.push(ref ?? null);
  return resolvedAll(refs, from);
}

/** Every file in the copy a stylesheet names: its fonts and pictures. */
export function stylesheetReferences(css: string, from: string): string[] {
  return resolvedAll(
    [...css.matchAll(CSS_URL)].map(([, , ref]) => ref ?? null),
    from,
  );
}

function resolvedAll(refs: readonly (string | null)[], from: string): string[] {
  const paths = refs.flatMap((ref) => {
    const path = ref === null ? null : resolveArtifactReference({ from, ref });
    return path === null ? [] : [path];
  });
  return [...new Set(paths)];
}

/**
 * The page with every file it names from the copy written into it, and the
 * policy put first in its head.
 *
 * `files` holds what was read, by path in the copy. A stylesheet becomes a
 * `<style>`, a script's `src` becomes its body, and a picture's `src` or a
 * `url()` becomes a `data:` URL. Anything `files` does not hold is left alone.
 */
export function inlineArtifactPage({
  html,
  from,
  files,
}: {
  html: string;
  from: string;
  files: ReadonlyMap<string, InlineFile>;
}): string {
  const lookup = (ref: string | null, base = from): InlineFile | null => {
    const path = ref === null ? null : resolveArtifactReference({ from: base, ref });
    return path === null ? null : (files.get(path) ?? null);
  };
  const cssOf = (css: string, base: string) => inlineUrls(css, (ref) => lookup(ref, base));

  const page = html
    .replace(LINK_TAG, (tag) => inlineLink({ tag, from, lookup, cssOf }))
    .replace(SCRIPT_TAG, (tag, attrs: string, body: string) =>
      inlineScript({ tag, attrs, body, lookup }),
    )
    .replace(MEDIA_TAG, (tag) => withDataSource(tag, lookup(attribute(tag, 'src'))))
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, (block) => cssOf(block, from))
    .replace(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi, (attr) => cssOf(attr, from));
  return withArtifactCsp(page);
}

type Lookup = (ref: string | null, base?: string) => InlineFile | null;

function inlineLink({
  tag,
  from,
  lookup,
  cssOf,
}: {
  tag: string;
  from: string;
  lookup: Lookup;
  cssOf: (css: string, base: string) => string;
}): string {
  const href = attribute(tag, 'href');
  const file = lookup(href);
  if (file === null || href === null) return tag;
  if (isStylesheet(tag) && 'text' in file) {
    // The stylesheet's own `url()`s are relative to where it sits, not to the page.
    const base = resolveArtifactReference({ from, ref: href }) ?? from;
    return `<style>${escapeClosing(cssOf(file.text, base), 'style')}</style>`;
  }
  return 'dataUrl' in file ? replaceAttribute(tag, 'href', file.dataUrl) : tag;
}

function inlineScript({
  tag,
  attrs,
  body,
  lookup,
}: {
  tag: string;
  attrs: string;
  body: string;
  lookup: Lookup;
}): string {
  const file = lookup(attribute(` ${attrs}`, 'src'));
  if (file === null || !('text' in file) || body.trim() !== '') return tag;
  const rest = attrs.replace(/\s+src\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '');
  return `<script${rest}>${escapeClosing(file.text, 'script')}</script>`;
}

function withDataSource(tag: string, file: InlineFile | null): string {
  return file !== null && 'dataUrl' in file ? replaceAttribute(tag, 'src', file.dataUrl) : tag;
}

function inlineUrls(css: string, lookup: (ref: string) => InlineFile | null): string {
  return css.replace(CSS_URL, (whole, _quote: string, ref: string) => {
    const file = lookup(ref);
    // Unquoted: a base64 `data:` URL holds no quote or bracket, and quotes
    // here would end a `style="…"` attribute early.
    return file !== null && 'dataUrl' in file ? `url(${file.dataUrl})` : whole;
  });
}

function replaceAttribute(tag: string, name: string, value: string): string {
  const pattern = new RegExp(`(\\s${name}\\s*=\\s*)(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
  return tag.replace(pattern, (_whole, lead: string) => `${lead}"${value}"`);
}

/** Text that cannot end the element it is written into: `</script>` inside a script, say. */
function escapeClosing(text: string, element: 'script' | 'style'): string {
  return text.replace(new RegExp(`</${element}`, 'gi'), `<\\/${element}`);
}

/**
 * The page with Atlas's policy as the first thing the parser meets after the
 * doctype. Searching the page for its `<head>` is unsafe — a `<head>` in a
 * comment or an attribute, or a script or text before the real one, puts the
 * meta where it governs nothing — so the meta goes first and the parser opens
 * the head around it before anything else. After a leading doctype, never
 * before it, which would drop the page into quirks mode. The page's own
 * policy, if any, stays: a second policy can only narrow the first.
 */
export function withArtifactCsp(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`;
  const page = html.startsWith('﻿') ? html.slice(1) : html;
  const doctype = LEADING_DOCTYPE.exec(page);
  const end = doctype === null ? 0 : doctype[0].length;
  return `${page.slice(0, end)}${meta}${page.slice(end)}`;
}

/** A doctype with only whitespace and comments before it — the one place it can appear. */
const LEADING_DOCTYPE = /^(?:\s|<!--[\s\S]*?-->)*<!doctype\b[^>]*>/i;

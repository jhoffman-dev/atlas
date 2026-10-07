import type { EditorDocument, EditorNode } from '../markdown/editor-node.ts';

/*
 * A note's page, as one self-contained document to picture: the body drawn
 * by the editor's own schema (so raw HTML in a note is shown as its source,
 * as the editor shows it), its images written into it, and a policy first
 * that lets nothing run and nothing be fetched.
 */

/**
 * The policy a note's page is pictured under. Stricter than an artifact's:
 * a note has no scripts to run and no fonts or styles to fetch — everything
 * it shows is written into the page.
 */
export const NOTE_PAGE_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  'font-src data:',
  'img-src data: blob:',
  "media-src 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

/**
 * The largest image written into a page to be pictured. A picture 640 pixels
 * wide needs nothing like it; a bigger one is left out rather than sent whole.
 */
export const MAX_PAGE_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * The most image bytes written into one page, all its images together: the
 * page goes to the process that pictures it whole, a third larger again as
 * `data:` URLs. Images past it are left out, as one too big alone is.
 */
export const MAX_PAGE_IMAGES_BYTES = 24 * 1024 * 1024;

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Text made safe to put anywhere in HTML. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

/**
 * The whole page: the policy first after the doctype — before anything the
 * parser could be talked out of — then the styles, the title and the body.
 * `bodyHtml` is the editor's serialisation of the note, which escapes every
 * piece of text it holds; `styles` are the app's own.
 */
export function notePageDocument({
  title,
  bodyHtml,
  styles,
}: {
  title: string;
  bodyHtml: string;
  styles: string;
}): string {
  const heading = escapeHtml(title);
  return [
    '<!doctype html>',
    `<meta http-equiv="Content-Security-Policy" content="${NOTE_PAGE_CSP}">`,
    '<meta charset="utf-8">',
    `<title>${heading}</title>`,
    `<style>${styles.replace(/<\/style/gi, '<\\/style')}</style>`,
    `<body><article class="page"><h1 class="page__title">${heading}</h1>`,
    `<div class="page__body">${bodyHtml}</div></article></body>`,
  ].join('');
}

/** Every image source a note's body names, once each, in order. */
export function pageImageSources(doc: EditorDocument): string[] {
  const sources: string[] = [];
  const visit = (nodes: readonly EditorNode[]) => {
    for (const node of nodes) {
      const src = node.attrs?.['src'];
      if (node.type === 'image' && typeof src === 'string' && !sources.includes(src)) {
        sources.push(src);
      }
      visit(node.content ?? []);
    }
  };
  visit(doc.content);
  return sources;
}

/**
 * The body with each image's source replaced by the picture itself, as a
 * `data:` URL. An image that could not be read — or that lives on the web,
 * which the page may not reach — is left out rather than shown broken.
 */
export function withInlinedImages(
  doc: EditorDocument,
  inlined: ReadonlyMap<string, string>,
): EditorDocument {
  return { type: 'doc', content: inlineNodes(doc.content, inlined) };
}

function inlineNodes(
  nodes: readonly EditorNode[],
  inlined: ReadonlyMap<string, string>,
): EditorNode[] {
  const kept: EditorNode[] = [];
  for (const node of nodes) {
    if (node.type === 'image') {
      const src = inlined.get(String(node.attrs?.['src'] ?? ''));
      if (src !== undefined) kept.push({ ...node, attrs: { ...node.attrs, src } });
      continue;
    }
    kept.push(
      node.content === undefined ? node : { ...node, content: inlineNodes(node.content, inlined) },
    );
  }
  return kept;
}

import { readWikiLink, type MarkdownSpan, type RawPart } from '@atlas/domain';
import type { Definition, Nodes, Parents, Root } from 'mdast';
import { parseBodyToMdast } from './markdown-blocks.ts';
import './mdast-custom-nodes.ts';

/*
 * What a raw block holds that an export rewrites (P32-07), read by the same
 * parser that found the block unmodelled: remark, with GFM and the wiki-link
 * syntax. The note's definitions are read after it, so a reference reads as
 * it does there: by the first definition of its label in the note, which is
 * the order they are given in. No id is a part: the editor reads none inside
 * a block it does not model, only on the line after one.
 */

/** The parts of `markdown`, with `definitions` in reach; none found in the definitions themselves. */
export function readRawParts(markdown: string, definitions: readonly string[]): RawPart[] {
  const text = [markdown, ...definitions].join('\n\n');
  const root = parseBodyToMdast(text);
  const parts: RawPart[] = [];
  const reader = new PartReader(text, definitionsIn(root, markdown.length), parts);
  reader.children(root);
  return parts
    .filter((part) => part.start < markdown.length)
    .map((part) => (part.end > markdown.length ? { ...part, end: markdown.length } : part));
}

type Resolved = Pick<Definition, 'url' | 'title'>;

class PartReader {
  constructor(
    private readonly text: string,
    private readonly defined: ReadonlyMap<string, Resolved>,
    private readonly parts: RawPart[],
  ) {}

  children(parent: Parents, depth = 0): void {
    const blocks = HOLDS_BLOCKS.has(parent.type);
    for (const child of parent.children) this.node(child as Nodes, blocks ? depth : null);
  }

  /** A node, and its depth among blocks when it is one (null when it is inline). */
  private node(node: Nodes, depth: number | null): void {
    const at = spanOf(node);
    // Code holds no nodes, only its text: nothing in it is ever a part.
    if (at === null) return;
    if (depth !== null) this.parts.push({ ...at, kind: 'block', type: node.type, depth });
    this.read(node, at);
    if ('children' in node) this.children(node, (depth ?? 0) + 1);
  }

  private read(node: Nodes, at: MarkdownSpan): void {
    const { parts } = this;
    switch (node.type) {
      case 'wikiLink': {
        const link = readWikiLink(node.value);
        if (link !== null) parts.push({ ...at, kind: 'wiki-link', link });
        return;
      }
      case 'image':
        parts.push({ ...at, kind: 'image', ...imageOf(node), reference: false });
        return;
      case 'imageReference': {
        const target = this.defined.get(node.identifier);
        if (target === undefined) return;
        const alt = node.alt ?? '';
        parts.push({
          ...at,
          kind: 'image',
          url: target.url,
          alt,
          title: target.title ?? null,
          reference: true,
        });
        return;
      }
      case 'link':
        parts.push({
          ...at,
          kind: 'link',
          url: node.url,
          title: node.title ?? null,
          reference: false,
          words: wordsOf(node, at),
        });
        return;
      case 'linkReference':
        this.reference(node, at);
        return;
      case 'definition':
        parts.push({ ...at, kind: 'definition', url: node.url });
        return;
      case 'footnoteDefinition':
        parts.push({ ...at, kind: 'footnote-definition' });
        parts.push(labelPart(node.label ?? node.identifier, at.start, true));
        return;
      case 'footnoteReference':
        parts.push(labelPart(node.label ?? node.identifier, at.start, true));
        return;
      case 'text':
        parts.push(...strayFootnotes(this.text.slice(at.start, at.end), at.start));
        return;
      case 'html':
        parts.push({ ...at, kind: 'html' });
        return;
      case 'blockquote':
        this.quoteOpening(node);
        return;
      default:
        return;
    }
  }

  private reference(node: Extract<Nodes, { type: 'linkReference' }>, at: MarkdownSpan): void {
    const target = this.defined.get(node.identifier);
    if (target === undefined) return;
    this.parts.push({
      ...at,
      kind: 'link',
      url: target.url,
      title: target.title ?? null,
      reference: true,
      words: wordsOf(node, at),
    });
  }

  /** Where a quote's first paragraph starts: a callout's marker, if it is one. */
  private quoteOpening(node: Extract<Nodes, { type: 'blockquote' }>): void {
    const [first] = node.children;
    const at = first?.type === 'paragraph' ? spanOf(first) : null;
    if (at !== null) this.parts.push({ ...at, kind: 'quote-opening' });
  }
}

function spanOf(node: Nodes): MarkdownSpan | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? null : { start, end };
}

function imageOf(node: Extract<Nodes, { type: 'image' }>): {
  url: string;
  alt: string;
  title: string | null;
} {
  return { url: node.url, alt: node.alt ?? '', title: node.title ?? null };
}

/** Where a link's words are: from its first child to its last, or just inside its `[` when it has none. */
function wordsOf(
  node: Extract<Nodes, { type: 'link' | 'linkReference' }>,
  at: MarkdownSpan,
): MarkdownSpan {
  const first = node.children[0] === undefined ? null : spanOf(node.children[0]);
  const last = node.children.at(-1) === undefined ? null : spanOf(node.children.at(-1) as Nodes);
  if (first === null || last === null) return { start: at.start + 1, end: at.start + 1 };
  return { start: first.start, end: last.end };
}

/** A footnote's label inside `[^label]`, which starts at `start`. */
function labelPart(label: string, start: number, defined: boolean): RawPart {
  const from = start + 2;
  return { start: from, end: from + label.length, kind: 'footnote-label', label, defined };
}

const STRAY_FOOTNOTE = /(?<!\\)\[\^([^\]\s]+)\]/g;

/** Text that reads like a reference to a footnote, where none is defined to answer it. */
function strayFootnotes(source: string, offset: number): RawPart[] {
  return [...source.matchAll(STRAY_FOOTNOTE)].map((found) =>
    labelPart(found[1] ?? '', offset + found.index, false),
  );
}

/** The nodes whose children are blocks, rather than words. */
const HOLDS_BLOCKS: ReadonlySet<string> = new Set([
  'root',
  'blockquote',
  'list',
  'listItem',
  'footnoteDefinition',
  'table',
  'tableRow',
]);

/**
 * Where each label goes, by the first definition of it in the note: those
 * given in reach, which are the note's own in its order, before any in the
 * block itself (which are among them whenever the note's are given).
 */
function definitionsIn(root: Root, blockLength: number): Map<string, Resolved> {
  const given: Definition[] = [];
  const own: Definition[] = [];
  const visit = (node: Nodes) => {
    if (node.type === 'definition') {
      ((node.position?.start.offset ?? 0) >= blockLength ? given : own).push(node);
    } else if ('children' in node) {
      for (const child of node.children) visit(child as Nodes);
    }
  };
  visit(root);
  const found = new Map<string, Resolved>();
  for (const node of [...given, ...own]) {
    if (!found.has(node.identifier)) {
      found.set(node.identifier, { url: node.url, title: node.title ?? null });
    }
  }
  return found;
}

import {
  readWikiLink,
  standaloneBlockAnchor,
  type MarkdownSpan,
  type RawPart,
} from '@atlas/domain';
import type { Definition, ListItem, Nodes, Parents, Root } from 'mdast';
import { paragraphAnchor } from './block-anchors.ts';
import { parseBodyToMdast } from './markdown-blocks.ts';
import './mdast-custom-nodes.ts';

/*
 * What a raw block holds that an export rewrites (P32-07), read by the same
 * parser that found the block unmodelled: remark, with GFM and the wiki-link
 * syntax. The note's definitions are read after it, as they are in the note,
 * so a reference reads as it does there. Code is never descended into.
 */

/** The parts of `markdown`, with `definitions` in reach; none found in the definitions themselves. */
export function readRawParts(markdown: string, definitions: readonly string[]): RawPart[] {
  const text = [markdown, ...definitions].join('\n\n');
  const root = parseBodyToMdast(text);
  const parts: RawPart[] = [];
  const reader = new PartReader(text, definitionsIn(root), parts);
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

  children(parent: Parents): void {
    for (const child of parent.children) this.node(child as Nodes, parent);
  }

  private node(node: Nodes, parent: Parents): void {
    const at = spanOf(node);
    // Code holds no nodes, only its text: nothing in it is ever a part.
    if (at === null) return;
    this.read(node, at, parent);
    if ('children' in node) this.children(node);
  }

  private read(node: Nodes, at: MarkdownSpan, parent: Parents): void {
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
      case 'paragraph':
      case 'heading':
        if (parent.type === 'root') this.idAtEnd(node);
        return;
      case 'listItem':
        this.itemId(node);
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

  /** The id ending a paragraph or a heading of the block's own, as the editor reads one. */
  private idAtEnd(node: Extract<Nodes, { type: 'paragraph' | 'heading' }>): void {
    const anchor = paragraphAnchor(node, this.text);
    if (anchor !== null) {
      this.parts.push({ start: anchor.start, end: anchor.end, kind: 'block-id', id: anchor.id });
    }
  }

  /** A list item's id: ending its first line, or alone after a task's box (`- [ ] ^id`). */
  private itemId(item: ListItem): void {
    const [first] = item.children;
    if (first?.type !== 'paragraph') return;
    const at = spanOf(first);
    const task = item.checked !== null && item.checked !== undefined;
    const alone = at === null ? null : standaloneBlockAnchor(this.text.slice(at.start, at.end));
    if (task && at !== null && alone !== null) {
      this.parts.push({ ...at, kind: 'block-id', id: alone });
      return;
    }
    this.idAtEnd(first);
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

function definitionsIn(root: Root): Map<string, Resolved> {
  const found = new Map<string, Resolved>();
  const visit = (node: Nodes) => {
    if (node.type === 'definition' && !found.has(node.identifier)) {
      found.set(node.identifier, { url: node.url, title: node.title ?? null });
    } else if ('children' in node) {
      for (const child of node.children) visit(child as Nodes);
    }
  };
  visit(root);
  return found;
}

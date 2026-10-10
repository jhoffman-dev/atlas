import type { EditorNode } from '../markdown/editor-node.ts';
import type { RawPart, RawPartsReader } from './raw-parts.ts';

/** The node holding markdown the editor does not model, as its `markdown` attribute. */
export const RAW_BLOCK = 'rawBlock';

/** The markdown a raw block holds. */
export const rawMarkdownOf = (node: EditorNode): string => String(node.attrs?.['markdown'] ?? '');

/**
 * What reading one note's blocks on the page depends on (P32-07): the
 * definitions its references can reach, and the label each of its footnotes
 * is written with. A note's blocks and a block it shows come from different
 * notes, each with its own footnotes, but share one page, where two
 * footnotes of one label would be one.
 */
export interface ExportScope {
  /** The note's link and footnote definitions, each as its own markdown. */
  readonly definitions: readonly string[];
  readonly footnoteLabel: (label: string) => string;
  /** Whether text reading like a footnote the note does not define is escaped. */
  readonly escapeStrayFootnotes: boolean;
}

/** Hands each note on the page its scope, keeping every footnote label on the page its own. */
export class PageScopes {
  private readonly taken = new Set<string>();

  constructor(private readonly readRaw: RawPartsReader) {}

  /** The scope of the note being exported: its footnotes keep their labels. */
  note(nodes: readonly EditorNode[]): ExportScope {
    const definitions = this.definitionsIn(nodes);
    for (const part of this.labelsIn(nodes)) this.taken.add(labelKey(part.label));
    return { definitions, footnoteLabel: (label) => label, escapeStrayFootnotes: false };
  }

  /**
   * The scope of a block shown from the note titled `title`: each of its
   * footnotes labelled after that note, numbered past any label already on
   * the page, and any reference to one it does not hold left as text.
   */
  shown(nodes: readonly EditorNode[], title: string): ExportScope {
    const definitions = this.definitionsIn(nodes);
    const labels = new Map<string, string>();
    for (const part of this.labelsIn(nodes)) {
      const key = labelKey(part.label);
      if (part.defined && !labels.has(key)) labels.set(key, part.label);
    }
    const prefix = this.freePrefix(slugOf(title), [...labels.values()]);
    const renamed = new Map([...labels].map(([key, label]) => [key, `${prefix}-${label}`]));
    for (const label of renamed.values()) this.taken.add(labelKey(label));
    return {
      definitions,
      footnoteLabel: (label) => renamed.get(labelKey(label)) ?? label,
      escapeStrayFootnotes: true,
    };
  }

  private freePrefix(base: string, labels: readonly string[]): string {
    for (let count = 1; ; count += 1) {
      const prefix = count === 1 ? base : `${base}-${count}`;
      if (labels.every((label) => !this.taken.has(labelKey(`${prefix}-${label}`)))) return prefix;
    }
  }

  private definitionsIn(nodes: readonly EditorNode[]): string[] {
    return rawBlocksIn(nodes).flatMap((markdown) =>
      this.readRaw(markdown, [])
        .filter((part) => part.kind === 'definition' || part.kind === 'footnote-definition')
        .map((part) => markdown.slice(part.start, part.end)),
    );
  }

  /**
   * Every footnote label in the blocks, defined or not. A label defined in
   * the note is read in its definition, so no definitions need be in reach.
   */
  private labelsIn(nodes: readonly EditorNode[]): Extract<RawPart, { kind: 'footnote-label' }>[] {
    return rawBlocksIn(nodes).flatMap((markdown) =>
      this.readRaw(markdown, []).filter((part) => part.kind === 'footnote-label'),
    );
  }
}

/**
 * A label as markdown matches it: case folded and its runs of space made one,
 * so `[^Sources-1]` and `[^sources-1]` are the same footnote.
 */
const labelKey = (label: string): string => label.trim().replace(/\s+/g, ' ').toLowerCase();

function rawBlocksIn(nodes: readonly EditorNode[]): string[] {
  return nodes.flatMap((node) =>
    node.type === RAW_BLOCK ? [rawMarkdownOf(node)] : rawBlocksIn(node.content ?? []),
  );
}

/** A note's title as a footnote label can hold it: letters, digits and dashes. */
function slugOf(title: string): string {
  const slug = title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug === '' ? 'shown' : slug;
}

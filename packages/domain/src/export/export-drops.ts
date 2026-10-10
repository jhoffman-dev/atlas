/**
 * What a note shared outside Atlas leaves behind (P32-07), by kind, in this
 * order. Nothing is left out without being named here, so whoever shares the
 * page can say what it lacks.
 */
export const EXPORT_DROP_KINDS = [
  /** A frontmatter key: a note's properties stay in Atlas. */
  'property',
  /** Where a link went: its words are kept, but the note it opens is not on the page. */
  'link',
  /** A note or file shown in place, `![[x]]`, that is not a block: named instead. */
  'embed',
  /** A shown block whose note, or whose block in it, is not there to show. */
  'missing-embed',
  /** An image in the vault, which the page cannot reach: its words are kept. */
  'image',
  /** `^id`: names a block for Atlas and Obsidian alone. */
  'block-id',
  /** `<!-- … -->`: hidden in the note, and left off the page. */
  'comment',
  /** A callout's fold, `[!faq]-`: a quote on the page is always open. */
  'callout-fold',
  /**
   * The formatting of a block whose rewrite would have read as something
   * else — another kind of block, or a link the page cannot follow — and so
   * is shared as its words alone. Named by its first line.
   */
  'formatting',
] as const;

export type ExportDropKind = (typeof EXPORT_DROP_KINDS)[number];

/** One kind of thing an export dropped, and each one it dropped. */
export interface ExportDrops {
  readonly kind: ExportDropKind;
  /** As the note writes each: a key, a link, an address, an id, a comment. Once each, in note order. */
  readonly items: readonly string[];
}

/** The drops of one export, gathered as it goes. */
export class DroppedContent {
  private readonly byKind = new Map<ExportDropKind, Set<string>>();

  add(kind: ExportDropKind, item: string): void {
    const items = this.byKind.get(kind) ?? new Set<string>();
    items.add(item);
    this.byKind.set(kind, items);
  }

  list(): ExportDrops[] {
    return EXPORT_DROP_KINDS.flatMap((kind) => {
      const items = this.byKind.get(kind);
      return items === undefined ? [] : [{ kind, items: [...items] }];
    });
  }
}

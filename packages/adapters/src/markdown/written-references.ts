import type { Nodes, Root } from 'mdast';
import { decodeString } from 'micromark-util-decode-string';
import './mdast-custom-nodes.ts';

/**
 * The characters a block's source wrote as references — `&amp;`, `&copy;`,
 * `&#35;` — each with the one reference it was written as (A21-03). The
 * editor holds only the character, so without this an edit anywhere in the
 * block wrote `AT&amp;T` back as `AT&T`: the same to read, not what the file
 * said. A character counts only when every one of it in the block's text was
 * written as that same reference; one written both ways is left as typed.
 */
export type WrittenReferences = ReadonlyMap<string, string>;

/**
 * The characters kept as references: not a letter, digit, space or tab.
 * Those are references only where remark had to encode one beside a `**`
 * (`&#x61;`, `&#x20;`), and kept, every `a` or space typed in the block after
 * would be written that way too.
 */
const KEPT = /^[^A-Za-z0-9 \t]$/u;

const REFERENCE = /&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g;

export function referencesIn(root: Root, source: string): WrittenReferences {
  const spellings = new Map<string, Set<string>>();
  const written = new Map<string, number>();
  const texts: string[] = [];
  visitText(root, (value, start, end) => {
    texts.push(value);
    const bytes = source.slice(start, end);
    for (const match of bytes.matchAll(REFERENCE)) {
      // `\&amp;` is the text `&amp;`, not a reference.
      if (bytes[match.index - 1] === '\\') continue;
      const character = decodeString(match[0]);
      if (character === match[0] || !KEPT.test(character)) continue;
      spellings.set(character, (spellings.get(character) ?? new Set()).add(match[0]));
      written.set(character, (written.get(character) ?? 0) + 1);
    }
  });
  const text = texts.join('');
  const references = new Map<string, string>();
  for (const [character, spelled] of spellings) {
    const everyOne = text.split(character).length - 1 === written.get(character);
    if (spelled.size === 1 && everyOne) references.set(character, [...spelled][0]!);
  }
  return references;
}

function visitText(node: Nodes, found: (value: string, start: number, end: number) => void): void {
  if (node.type === 'text') {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) found(node.value, start, end);
    return;
  }
  if ('children' in node) for (const child of node.children as Nodes[]) visitText(child, found);
}

/**
 * Writes each character of `references` in the text of `node` as its
 * reference again, verbatim. Whether the block still reads the same is for
 * `writeAsTyped` to check: a reference is punctuation to markdown where the
 * character may not have been.
 */
export function keepReferences(node: Nodes, references: WrittenReferences): void {
  if (references.size === 0 || !('children' in node)) return;
  const pattern = new RegExp(`(${[...references.keys()].map(escapeRegExp).join('|')})`, 'u');
  const children = node.children as Nodes[];
  const rewritten = children.flatMap((child): Nodes[] => {
    if (child.type !== 'text') {
      keepReferences(child, references);
      return [child];
    }
    return child.value
      .split(pattern)
      .filter((piece) => piece !== '')
      .map((piece) =>
        references.has(piece)
          ? { type: 'verbatimInline', value: references.get(piece)! }
          : { type: 'text', value: piece },
      );
  });
  children.splice(0, children.length, ...rewritten);
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The ProseMirror document shape, as plain data.
 *
 * Declared here so the markdown adapter and the editor component agree on it
 * without either depending on the other, and without the domain depending on
 * ProseMirror itself.
 */
export interface EditorMark {
  readonly type: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
}

export interface EditorNode {
  readonly type: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
  readonly content?: readonly EditorNode[];
  readonly text?: string;
  readonly marks?: readonly EditorMark[];
}

export interface EditorDocument {
  readonly type: 'doc';
  readonly content: readonly EditorNode[];
}

/** Identifies the block a node came from, so untouched blocks keep their bytes. */
export const BLOCK_ID_ATTR = 'blockId';

export function blockIdOf(node: EditorNode): string | null {
  const id = node.attrs?.[BLOCK_ID_ATTR];
  return typeof id === 'string' ? id : null;
}

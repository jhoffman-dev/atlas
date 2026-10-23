import { useMemo } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { BLOCK_ANCHOR_ATTR } from '@dfai/domain';
import { HighlightCommentField, HighlightQuote } from './highlight-quote.tsx';
import type { RawBlockOptions } from './raw-block.ts';

/**
 * A highlight in its literature note (#523): its quote, in its mark's colour,
 * and its comment as a field to type in. The block is still one atom of the
 * note — selected, moved and deleted whole — and is saved from its bytes; the
 * comment is written by the literature note's own write. The quote is the
 * source's words and is not typed into here.
 */
export function HighlightBlockView({ node, extension, selected }: NodeViewProps) {
  const { highlights, readerLinks } = extension.options as RawBlockOptions;
  const markdown = String(node.attrs['markdown'] ?? '');
  const id = String(node.attrs[BLOCK_ANCHOR_ATTR] ?? '');
  const view = useMemo(
    () => highlights?.viewOf({ markdown, id }) ?? null,
    [highlights, markdown, id],
  );
  if (highlights === null || view === null) return null;
  const label = readerLinks?.labelFor(id) ?? null;
  return (
    <NodeViewWrapper
      className={selected ? 'highlight-block highlight-block--selected' : 'highlight-block'}
      data-highlight-block={id}
      contentEditable={false}
    >
      <HighlightQuote
        view={view}
        loadImage={highlights.loadImage}
        comment={
          <HighlightCommentField
            id={id}
            comment={view.comment}
            drafts={highlights.drafts}
            onSave={highlights.editComment}
          />
        }
      />
      {label !== null && (
        <a
          className="raw-block__open highlight-block__open wikilink"
          data-wikilink=""
          data-heading={`#^${id}`}
          role="link"
          tabIndex={0}
        >
          {label}
        </a>
      )}
    </NodeViewWrapper>
  );
}

import { useEffect, useState } from 'react';
import { Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';

export interface ImageOptions {
  /**
   * Turns a markdown image source into something the webview can display.
   * Resolves to null when the image cannot be found or read.
   */
  loadImage: (src: string) => Promise<string | null>;
}

function ImageView({ node, extension, selected, editor, updateAttributes, getPos }: NodeViewProps) {
  const src = String(node.attrs['src'] ?? '');
  const alt = (node.attrs['alt'] as string | null) ?? '';
  // One piece of state, written only from the resolution callbacks: setting state
  // synchronously inside the effect would render twice for every image.
  const [loaded, setLoaded] = useState<{ url: string | null; failed: boolean }>({
    url: null,
    failed: false,
  });
  const { url, failed } = loaded;

  const loadImage = (extension.options as ImageOptions).loadImage;

  useEffect(() => {
    let cancelled = false;
    loadImage(src)
      .then((resolved) => {
        if (!cancelled) setLoaded({ url: resolved, failed: resolved === null });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ url: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [loadImage, src]);

  return (
    <NodeViewWrapper as="span" className={selected ? 'image image--selected' : 'image'}>
      {failed ? (
        <span className="image__missing" title={src}>
          Missing image: {src}
        </span>
      ) : (
        url !== null && <img className="image__img" src={url} alt={alt} title={src} />
      )}
      {editor.isEditable && (
        <AltTextField
          alt={alt}
          selected={selected}
          onChange={(value) => updateAttributes({ alt: value === '' ? null : value })}
          onDone={() => {
            const at = getPos();
            editor.commands.focus(at === undefined ? undefined : at + node.nodeSize);
          }}
        />
      )}
    </NodeViewWrapper>
  );
}

/**
 * The selected image's alt text, under it. Each keystroke is written to the
 * node, which moves the editor's selection off the image, so the field stays
 * open for as long as it has the focus rather than for as long as the image is
 * selected. Enter or Escape hands the cursor back, just after the image.
 */
function AltTextField({
  alt,
  selected,
  onChange,
  onDone,
}: {
  alt: string;
  selected: boolean;
  onChange: (alt: string) => void;
  onDone: () => void;
}) {
  const [focused, setFocused] = useState(false);
  if (!selected && !focused) return null;
  return (
    <span className="image__alt" contentEditable={false}>
      <input
        className="image__alt-input"
        aria-label="Alt text"
        placeholder="Describe the image"
        value={alt}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== 'Escape') return;
          event.preventDefault();
          setFocused(false);
          onDone();
        }}
      />
    </span>
  );
}

/**
 * A markdown image. Bytes are fetched through the host rather than loaded by the
 * webview, so displaying an image needs no filesystem access of its own.
 */
export const VaultImage = Node.create<ImageOptions>({
  name: 'image',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: true,

  addOptions() {
    return { loadImage: async () => null };
  },

  addAttributes() {
    return {
      src: { default: '' },
      alt: { default: null },
      title: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'img[src]' }];
  },

  renderHTML({ node }) {
    return ['img', { src: String(node.attrs['src'] ?? ''), alt: String(node.attrs['alt'] ?? '') }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});

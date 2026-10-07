import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Icon } from './icon.tsx';

/** What the file pickers accept: a page and the files a page is made of. */
const ACCEPT = '.html,.htm,.css,.js,.json,.svg,.png,.jpg,.jpeg,.webp,.woff2';

/**
 * A place to drop files, with buttons to pick them instead: a page and its
 * files, or the folder that holds them. It only hands over what was dropped
 * or picked; what can be saved of it is decided by whoever receives it.
 */
export function FileDrop({
  label,
  onFiles,
  disabled = false,
  children,
}: {
  /** Names the drop zone for a screen reader. */
  label: string;
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);

  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');
  const pick = (input: HTMLInputElement) => {
    const picked = [...(input.files ?? [])];
    // Cleared, so choosing the same file again still counts as a choice.
    input.value = '';
    if (picked.length > 0) onFiles(picked);
  };

  return (
    <div
      className={over ? 'file-drop file-drop--over' : 'file-drop'}
      role="group"
      aria-label={label}
      onDragOver={(event) => {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        setOver(false);
        const dropped = [...event.dataTransfer.files];
        if (dropped.length > 0) onFiles(dropped);
      }}
    >
      <Icon name="artifact" size={22} className="file-drop__icon" />
      <div className="file-drop__text">{children}</div>
      <div className="file-drop__actions">
        <button
          type="button"
          className="btn btn--tinted"
          disabled={disabled}
          onClick={() => files.current?.click()}
        >
          Pick files…
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={disabled}
          onClick={() => folder.current?.click()}
        >
          Pick a folder…
        </button>
      </div>
      <input
        ref={files}
        className="file-drop__input"
        type="file"
        accept={ACCEPT}
        multiple
        aria-label="Choose the page's files"
        tabIndex={-1}
        onChange={(event) => pick(event.currentTarget)}
      />
      <input
        // `webkitdirectory` is not in React's attribute types; set on the element.
        ref={(element) => {
          folder.current = element;
          element?.setAttribute('webkitdirectory', '');
        }}
        className="file-drop__input"
        type="file"
        aria-label="Choose the page's folder"
        tabIndex={-1}
        onChange={(event) => pick(event.currentTarget)}
      />
    </div>
  );
}

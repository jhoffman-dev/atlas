import { createContext, useContext } from 'react';
import { noteNames, type LinkedName, type NoteNames, type VaultPath } from '@atlas/domain';

/**
 * The vault's notes by name, which every place that shows a relation reads
 * its links against. Until the app provides them, links read as their bare
 * names and none is called missing.
 */
const NoteNamesContext = createContext<NoteNames>(noteNames(null));

export const NoteNamesProvider = NoteNamesContext.Provider;

export function useNoteNames(): NoteNames {
  return useContext(NoteNamesContext);
}

/**
 * One linked note, by name: a button that opens it when there is a note to
 * open, otherwise its bare name, struck through when nothing answers to it.
 */
export function LinkedNote({
  name,
  className,
  onOpen,
}: {
  name: LinkedName;
  className: string;
  /** Left out where the note cannot be opened from here. */
  onOpen?: (path: VaultPath) => void;
}) {
  const { path } = name;
  if (path !== null && onOpen !== undefined) {
    return (
      <button
        type="button"
        className={className}
        aria-label={`Open ${name.text}`}
        onClick={(event) => {
          // A link inside something clickable opens its note, not the thing.
          event.stopPropagation();
          onOpen(path);
        }}
      >
        {name.text}
      </button>
    );
  }
  return (
    <span className={className} data-missing={name.missing}>
      {name.text}
    </span>
  );
}

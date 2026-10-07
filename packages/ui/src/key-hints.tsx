/** A key, or a chord of keys, drawn as a small chip: ⌘K, ↵, esc. */
export function Key({ children }: { children: string }) {
  return <kbd className="key">{children}</kbd>;
}

/**
 * The keys an overlay answers to, along its foot. Decoration for sighted
 * keyboard users: the controls themselves carry their own names, so a screen
 * reader is not read the list twice.
 */
export function KeyHints({ hints }: { hints: readonly (readonly [keys: string, does: string])[] }) {
  return (
    <footer className="key-hints" aria-hidden="true">
      {hints.map(([keys, does]) => (
        <span key={does} className="key-hints__hint">
          {keys.split(' ').map((key) => (
            <Key key={key}>{key}</Key>
          ))}
          {does}
        </span>
      ))}
    </footer>
  );
}

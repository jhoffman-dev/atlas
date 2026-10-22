import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { stepMatch, type DocumentMatch, type PageRect } from '@dfai/domain';
import type { ReaderActions } from './reader-types.ts';

/*
 * Find in the document (#504): ⌘F opens it, typing searches every page,
 * Enter and ⇧Enter step through what was found, Escape closes it.
 */

interface Found {
  readonly phrase: string;
  readonly matches: readonly DocumentMatch[];
  readonly more: boolean;
}

const NO_MATCHES: readonly DocumentMatch[] = [];

export function useFind({
  onSearch,
  goTo,
}: {
  onSearch: ReaderActions['onSearch'];
  goTo: (page: number, rect?: PageRect) => void;
}) {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState('');
  // Each result knows the phrase it is for, so a result for what was typed before is never shown.
  const [result, setResult] = useState<Found | null>(null);
  const [current, setCurrent] = useState<number | null>(null);
  const searched = useRef(0);
  const searching = open && phrase.trim() !== '';
  useEffect(() => {
    const ask = (searched.current += 1);
    if (!searching) return;
    onSearch(phrase).then(
      (answer) => {
        if (ask !== searched.current) return;
        setResult({ phrase, ...answer });
        setCurrent(answer.matches.length === 0 ? null : 0);
      },
      // A search that failed finds nothing; the next keystroke asks again.
      () => ask === searched.current && setResult({ phrase, matches: [], more: false }),
    );
  }, [searching, phrase, onSearch]);
  const found = searching && result?.phrase === phrase ? result : null;
  const matches = found?.matches ?? NO_MATCHES;
  const currentMatch = current === null ? null : (matches[current] ?? null);
  useEffect(() => {
    if (currentMatch !== null) goTo(currentMatch.page, currentMatch.rects[0]);
  }, [currentMatch, goTo]);
  const step = (back: boolean) => setCurrent((was) => stepMatch(was, matches.length, back));
  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      setOpen(true);
    }
  };
  return {
    open,
    phrase,
    setPhrase,
    found,
    matches,
    current,
    currentMatch,
    step,
    onKeyDown,
    toggle: () => setOpen((was) => !was),
    close: () => setOpen(false),
  };
}

export function FindBar({ find }: { find: ReturnType<typeof useFind> }) {
  return (
    <div className="pdf-find-bar" role="search">
      <input
        type="search"
        className="pdf-find-bar__field"
        aria-label="Find in document"
        placeholder="Find in document"
        autoFocus
        value={find.phrase}
        onChange={(event) => find.setPhrase(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            find.step(event.shiftKey);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            find.close();
          }
        }}
      />
      <span className="pdf-find-bar__count" aria-live="polite">
        {countLabel(find)}
      </span>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        aria-label="Previous match"
        onClick={() => find.step(true)}
      >
        ↑
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        aria-label="Next match"
        onClick={() => find.step(false)}
      >
        ↓
      </button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={find.close}>
        Done
      </button>
    </div>
  );
}

function countLabel(find: ReturnType<typeof useFind>): string {
  if (find.phrase.trim() === '') return '';
  if (find.found === null) return 'Searching…';
  const total = find.found.matches.length;
  if (total === 0) return 'Not found';
  return `${(find.current ?? 0) + 1} of ${total}${find.found.more ? '+' : ''}`;
}

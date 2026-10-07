import { useCallback, useEffect, useState } from 'react';
import type { NoteLinks, VaultPath } from '@atlas/domain';
import {
  findUnlinkedMentions,
  linkUnlinkedMention,
  type IndexPort,
  type MarkdownPort,
  type OpenNotes,
  type VaultFsPort,
} from '@atlas/application';
import type { MentionsState } from '@atlas/ui';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The open note's unlinked mentions: looked for only when asked — it reads
 * notes, which the foot of every note has no business doing on open — and
 * looked for again after one is linked or the index moves on.
 */
export function useUnlinkedMentions({
  ports,
  note,
  links,
  indexKey,
  onChanged,
}: {
  ports: { index: IndexPort; fs: VaultFsPort; markdown: MarkdownPort; openNotes: OpenNotes };
  note: { path: VaultPath; title: string } | null;
  links: NoteLinks;
  indexKey: string;
  onChanged: () => void;
}) {
  const [found, setState] = useState<{ for: VaultPath | null; state: MentionsState }>({
    for: null,
    state: { kind: 'idle' },
  });
  // Asked for per note: a different note starts from nothing, and is not searched until asked.
  const [wantedFor, setWantedFor] = useState<VaultPath | null>(null);
  const path = note?.path ?? null;
  const title = note?.title ?? '';
  const wanted = path !== null && wantedFor === path;
  const state: MentionsState = found.for === path ? found.state : { kind: 'idle' };

  useEffect(() => {
    if (!wanted || path === null) return;
    let cancelled = false;
    setState((was) =>
      was.for === path && was.state.kind === 'ready'
        ? was
        : { for: path, state: { kind: 'loading' } },
    );
    findUnlinkedMentions({
      ...ports,
      note: { path, title },
      linkedFrom: links.incoming.map((entry) => entry.path),
    })
      .then((mentions) => {
        if (!cancelled) setState({ for: path, state: { kind: 'ready', mentions } });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ for: path, state: { kind: 'failed', message: message(error) } });
      });
    return () => {
      cancelled = true;
    };
  }, [wanted, path, title, ports, links, indexKey]);

  const link = useCallback(
    (source: VaultPath) => {
      if (path === null) return;
      linkUnlinkedMention({ ...ports, source, target: { path, title } })
        .then(onChanged)
        .catch((error: unknown) =>
          setState({ for: path, state: { kind: 'failed', message: message(error) } }),
        );
    },
    [ports, path, title, onChanged],
  );

  return { state, find: () => setWantedFor(path), link };
}

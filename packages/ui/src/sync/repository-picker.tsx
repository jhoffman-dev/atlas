import { useEffect, useId, useState, type ReactNode } from 'react';

/** One of the person's GitHub repositories, as the picker shows it. */
export interface RepositoryChoice {
  readonly nameWithOwner: string;
  readonly url: string;
  readonly isPrivate: boolean;
  readonly defaultBranch: string | null;
}

/** The picker's list, as it loads. */
export type RepositoryListView =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly repositories: readonly RepositoryChoice[] }
  | { readonly kind: 'failed'; readonly problem: string };

/**
 * Settings → Sync's list of the person's GitHub repositories (A29-01), read
 * through the GitHub login already on this Mac, with a search. Connecting one
 * asks the host to confirm first, in its own dialog.
 */
export function RepositoryPicker({
  list,
  find,
  busy,
  onLoad,
  onConnect,
}: {
  list: RepositoryListView;
  /** The repositories a search finds; how is the app's to say. */
  find: (query: string) => readonly RepositoryChoice[];
  busy: boolean;
  onLoad: () => void;
  onConnect: (url: string) => void;
}) {
  const [query, setQuery] = useState('');
  const searchId = useId();
  useEffect(() => {
    if (list.kind === 'idle') onLoad();
  }, [list.kind, onLoad]);
  return (
    <section className="sync-form sync-picker" aria-label="Your GitHub repositories">
      <label className="sync-form__label" htmlFor={searchId}>
        Your GitHub repositories
      </label>
      <input
        id={searchId}
        className="field sync-picker__search"
        type="search"
        value={query}
        placeholder="Search by name or owner"
        spellCheck={false}
        autoComplete="off"
        disabled={list.kind !== 'ready'}
        onChange={(event) => setQuery(event.target.value)}
      />
      <PickerBody list={list} found={list.kind === 'ready' ? find(query) : []} query={query}>
        {(repository) => (
          <button
            className="btn btn--tinted btn--sm"
            type="button"
            disabled={busy}
            aria-label={`Connect ${repository.nameWithOwner}`}
            onClick={() => onConnect(repository.url)}
          >
            Connect
          </button>
        )}
      </PickerBody>
    </section>
  );
}

function PickerBody({
  list,
  found,
  query,
  children,
}: {
  list: RepositoryListView;
  found: readonly RepositoryChoice[];
  query: string;
  children: (repository: RepositoryChoice) => ReactNode;
}) {
  if (list.kind === 'idle' || list.kind === 'loading') {
    return <p className="sync-picker__note">Looking up your GitHub repositories…</p>;
  }
  if (list.kind === 'failed') {
    return (
      <p className="sync-picker__note" role="alert">
        {list.problem} You can still create a new one or paste an address below.
      </p>
    );
  }
  if (list.repositories.length === 0) {
    return <p className="sync-picker__note">You have no repositories on GitHub yet.</p>;
  }
  if (found.length === 0) {
    return <p className="sync-picker__note">No repository matches “{query.trim()}”.</p>;
  }
  return (
    <ul className="sync-picker__list">
      {found.map((repository) => (
        <li className="sync-picker__item" key={repository.url}>
          <span className="sync-picker__text">
            <span className="sync-picker__name">{repository.nameWithOwner}</span>
            <span className="sync-picker__meta">
              {repository.isPrivate ? 'Private' : 'Public'}
              {repository.defaultBranch !== null && ` · ${repository.defaultBranch}`}
            </span>
          </span>
          {children(repository)}
        </li>
      ))}
    </ul>
  );
}

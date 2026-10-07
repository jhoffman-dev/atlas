import type { AppInfo } from '@atlas/domain';
import { SettingsCard } from './settings-card.tsx';

export type IndexSummary =
  | { readonly kind: 'idle' }
  | { readonly kind: 'working'; readonly done: number; readonly total: number }
  | { readonly kind: 'ready'; readonly notes: number }
  | { readonly kind: 'failed'; readonly message: string };

export type AppInfoState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly info: AppInfo }
  | { readonly kind: 'failed'; readonly message: string };

/** What the index is doing, in words; empty when there is nothing to say. */
export function indexStatusText(index: IndexSummary): string {
  switch (index.kind) {
    case 'working':
      return index.total === 0 ? 'Indexing…' : `Indexing ${index.done}/${index.total}…`;
    case 'ready':
      return `${index.notes.toLocaleString()} notes indexed`;
    case 'failed':
      return index.message;
    case 'idle':
      return '';
  }
}

/**
 * The Index part of Settings: how many notes the search and the views can
 * see, a way to rebuild that from the files, and which build this is.
 */
export function IndexSettings({
  index,
  app,
  onRebuild,
}: {
  /** `null` with no vault open, when there is no index to speak of. */
  index: IndexSummary | null;
  app: AppInfoState;
  onRebuild: () => void;
}) {
  return (
    <SettingsCard id="settings-index" icon="search" title="Index">
      {index === null ? (
        <p className="settings__lede">Open a vault to index it.</p>
      ) : (
        <div className="settings__row">
          <span
            className={index.kind === 'failed' ? 'settings__problem' : 'settings__status'}
            role={index.kind === 'failed' ? 'alert' : undefined}
          >
            {indexStatusText(index)}
          </span>
          <button
            className="btn btn--tinted btn--sm"
            type="button"
            onClick={onRebuild}
            disabled={index.kind === 'working'}
          >
            Rebuild
          </button>
        </div>
      )}
      {app.kind === 'ready' && (
        <p className="settings__file">
          {app.info.name} {app.info.version}
        </p>
      )}
      {app.kind === 'failed' && (
        <p className="settings__problem" role="alert">
          {app.message}
        </p>
      )}
    </SettingsCard>
  );
}

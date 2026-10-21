import { SettingsSection } from './settings-section.tsx';
import { SETTINGS_SECTIONS } from './settings-section-links.ts';

export type IndexSummary =
  | { readonly kind: 'idle' }
  | { readonly kind: 'working'; readonly done: number; readonly total: number }
  | { readonly kind: 'ready'; readonly notes: number }
  | { readonly kind: 'failed'; readonly message: string };

/** What the index is doing, in words; empty when there is nothing to say. */
export function indexStatusText(index: IndexSummary): string {
  switch (index.kind) {
    case 'working':
      return index.total === 0
        ? 'Indexing…'
        : `Indexing ${index.done.toLocaleString()} of ${index.total.toLocaleString()}…`;
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
 * see, and a way to rebuild that from the files.
 */
export function IndexSettings({
  index,
  onRebuild,
}: {
  /** `null` with no vault open, when there is no index to speak of. */
  index: IndexSummary | null;
  onRebuild: () => void;
}) {
  return (
    <SettingsSection section={SETTINGS_SECTIONS.index}>
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
            className="btn btn--secondary"
            type="button"
            onClick={onRebuild}
            disabled={index.kind === 'working'}
          >
            Rebuild
          </button>
        </div>
      )}
    </SettingsSection>
  );
}

import { Icon } from '../icon.tsx';
import type { SyncTone } from './sync-settings.tsx';

/** The sidebar's small sync light: its tone, and a word or two on hover. Opens Settings → Sync. */
export function SyncIndicator({
  badge,
  onOpen,
}: {
  badge: { readonly tone: SyncTone; readonly label: string };
  onOpen: () => void;
}) {
  return (
    <button
      className={`sidebar-footer__sync sync-indicator sync-indicator--${badge.tone}`}
      type="button"
      title={`${badge.label} — Settings → Sync`}
      aria-label={`Sync: ${badge.label}`}
      data-tone={badge.tone}
      onClick={onOpen}
    >
      <Icon name="cloud" size={16} />
      <span className="sync-indicator__dot" aria-hidden="true" />
    </button>
  );
}

import { KindleSettings } from '@dfai/ui';
import type { KindleController } from '../kindle/use-kindle-sync.ts';

/** Settings → Kindle, wired to the window's Kindle sync. */
export function KindleSettingsCard({ kindle }: { kindle: KindleController }) {
  return (
    <KindleSettings
      view={kindle.view}
      onConnect={kindle.connect}
      onSyncNow={kindle.syncNow}
      onDisconnect={kindle.disconnect}
    />
  );
}

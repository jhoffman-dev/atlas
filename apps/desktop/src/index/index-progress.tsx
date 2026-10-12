import { useSyncExternalStore, type ComponentProps } from 'react';
import { IndexSettings, indexStatusText } from '@atlas/ui';
import type { IndexProgressStore, IndexStatus } from './use-index.ts';

/**
 * The index's status with a build's progress in it. Only what calls this
 * re-renders as a build moves along: the two small components below, not the
 * window (#135).
 */
function useLiveIndexStatus(status: IndexStatus, progress: IndexProgressStore): IndexStatus {
  const { done, total } = useSyncExternalStore(progress.subscribe, progress.current);
  return status.kind === 'working' ? { kind: 'working', done, total } : status;
}

/** The line at the foot of the window: "Indexing 1,240 of 5,000…", then how many notes it holds. */
export function IndexStatusLine({
  status,
  progress,
}: {
  status: IndexStatus;
  progress: IndexProgressStore;
}) {
  return <>{indexStatusText(useLiveIndexStatus(status, progress))}</>;
}

/** The Index card in Settings, saying how far a build has got while one runs. */
export function LiveIndexSettings({
  index,
  progress,
  ...card
}: Omit<ComponentProps<typeof IndexSettings>, 'index'> & {
  index: IndexStatus;
  progress: IndexProgressStore;
}) {
  return <IndexSettings index={useLiveIndexStatus(index, progress)} {...card} />;
}

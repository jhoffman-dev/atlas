import { useEffect, type ComponentProps } from 'react';
import type { WindowClosingPort } from '@atlas/application';
import { InboxPage } from '@atlas/ui';
import { useProposals } from '../proposals/use-proposals.ts';
import { localClock } from '../today.ts';
import type { PageContainerProps } from '../workspace/page-wiring.ts';
import type { PendingWrites } from './pending-writes.ts';
import { useInbox } from './use-inbox.ts';

type InboxPageProps = ComponentProps<typeof InboxPage>;

/**
 * What the Inbox page needs from the window beyond what every page is
 * handed: the offers the window makes on it (they are the window's, since a
 * dismissed offer stays dismissed whatever tab the Inbox is in), what it
 * says about the vault's settings and owner, the Inbox view it stands in
 * for, and the window's hold on the writes it makes in the background.
 */
export interface InboxWiring extends Pick<
  InboxPageProps,
  | 'typesOffer'
  | 'taskMigration'
  | 'paraMigration'
  | 'vaultTidy'
  | 'meetingCleanup'
  | 'meetingProjects'
  | 'settingsUnreadable'
  | 'ownerUnknown'
  | 'view'
> {
  /** The window's close, held until the clarifications and answers still being written are written. */
  readonly closing: WindowClosingPort;
  /** Where the page holds its writes for a vault switch and the window's close (#217, #166). */
  readonly pendingWrites: PendingWrites;
  /** Opens the line a proposal cites, in the focused pane. */
  readonly onOpenSource: (link: string) => void;
}

/**
 * The Inbox as a tab (tab-model.md, PR B): it lists what waits and answers
 * the proposals itself, so a row leaving or an answer landing draws this and
 * not the window. The sidebar's count is the window's own read. Writes made
 * in the background are held by the window through `pendingWrites`, so a
 * tab closed mid-write is still waited for.
 */
export function InboxContainer({ wiring, chrome }: PageContainerProps) {
  const { pages, pane } = wiring;
  // The offers are spread below, since each is given only while the window makes it.
  const { closing, pendingWrites, onOpenSource, ...offers } = pages.inbox;
  const inbox = useInbox({
    ports: pages.ports,
    notePaths: pane.notePaths,
    vaultKey: pane.vault,
    types: pane.types,
    clock: localClock,
    indexKey: pane.indexKey,
    indexReady: pages.indexReady,
    open: true,
    onSettled: pages.onSettled,
    activity: pane.activity,
    closing,
  });
  const proposals = useProposals({
    ports: pages.ports,
    clock: localClock,
    indexKey: pane.indexKey,
    onSettled: pages.onSettled,
    activity: pane.activity,
    closing,
  });
  const { written: inboxWritten } = inbox;
  const { written: answersWritten } = proposals;
  useEffect(() => pendingWrites.hold(inboxWritten), [pendingWrites, inboxWritten]);
  useEffect(() => pendingWrites.hold(answersWritten), [pendingWrites, answersWritten]);

  return (
    <InboxPage
      contents={inbox.contents}
      error={inbox.error}
      filing={inbox.filing}
      people={inbox.people}
      statuses={inbox.statuses}
      onOpen={pages.openNote}
      onShowMore={inbox.showMore}
      onClarify={inbox.clarify}
      busy={inbox.busy}
      problem={inbox.problem}
      refusals={inbox.refusals}
      summaryPending={inbox.summaryPending}
      lastAction={inbox.lastAction}
      onUndo={() => void inbox.undo()}
      onDismissLastAction={inbox.dismissLastAction}
      {...offers}
      proposals={{ ...proposals.section, onOpen: pages.openNote, onOpenSource }}
      {...chrome}
    />
  );
}

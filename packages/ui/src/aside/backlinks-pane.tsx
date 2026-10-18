import type { NoteLinks, VaultPath } from '@atlas/domain';
import { LinkGroup, UnlinkedMentions, type MentionsState } from '../note-links.tsx';

/**
 * The aside's Backlinks tab: the notes linking here, the notes this one links
 * to — relations named — and, on request, the notes that name it without a
 * link yet. The same groups the page's foot folds away (`NoteLinksPanel`),
 * open from the start: the tab was chosen, so there is nothing to unfold.
 */
export function BacklinksPane({
  links,
  incomingTitle = 'Links here',
  onOpen,
  mentions,
  onFindMentions,
  onLinkMention,
}: {
  links: NoteLinks;
  /** What the notes linking here are headed: "Mentioned in" on a person's page. */
  incomingTitle?: string;
  onOpen: (path: VaultPath) => void;
  mentions: MentionsState;
  /** Looks for unlinked mentions; asked for only when that group is opened. */
  onFindMentions: () => void;
  onLinkMention: (path: VaultPath) => void;
}) {
  return (
    <div className="aside-links links">
      <LinkGroup
        title={incomingTitle}
        empty="Nothing links here yet."
        entries={links.incoming}
        onOpen={onOpen}
      />
      <LinkGroup
        title="Links from this note"
        empty="This note links nowhere yet."
        entries={links.outgoing}
        onOpen={onOpen}
      />
      <UnlinkedMentions
        mentions={mentions}
        onFind={onFindMentions}
        onOpen={onOpen}
        onLink={onLinkMention}
      />
    </div>
  );
}

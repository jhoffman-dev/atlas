import { noteTitle, type VaultPath } from '@atlas/domain';
import type { LinkOffer } from './vault/use-vault-entries.ts';

/**
 * What the window has to tell the person, above whatever is open: plain
 * messages, the offer to update links a move left behind, and kept work that
 * could not be saved.
 */
export function AppNotices({
  messages,
  links,
  stranded,
}: {
  /** Each message shown on its own; a null is nothing to say. */
  messages: readonly (string | null)[];
  links: LinkOffer | null;
  stranded: {
    readonly notice: string | null;
    readonly waiting: readonly VaultPath[];
    readonly forget: (path: VaultPath) => void;
  };
}) {
  return (
    <>
      {messages.map(
        (message, at) =>
          message !== null && (
            <p key={at} className="notice" role="alert">
              {message}
            </p>
          ),
      )}
      {links !== null && (
        <div className="notice">
          <p role="alert">{links.text}</p>
          <button className="viewer__resolve" type="button" onClick={links.update}>
            {links.action}
          </button>
          <button className="viewer__resolve" type="button" onClick={links.dismiss}>
            Leave them
          </button>
        </div>
      )}
      {stranded.notice !== null && (
        <div className="notice">
          <p role="alert">{stranded.notice}</p>
          {/* Kept work for a note that has since been deleted can never be
              reopened, so it can also be let go of by hand. */}
          {stranded.waiting.map((path) => (
            <button
              key={path}
              className="viewer__resolve"
              type="button"
              onClick={() => stranded.forget(path)}
            >
              Discard kept changes to {noteTitle(path)}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

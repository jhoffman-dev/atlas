/**
 * Shown before a vault has been chosen — the only thing to do is choose one,
 * so the screen is one card: the app's tile, what it wants, and one button.
 */
export function VaultEmptyState({
  onChooseVault,
  onOpenFromGitHub,
}: {
  onChooseVault: () => void;
  /** Given when a vault can be copied from GitHub instead. */
  onOpenFromGitHub?: () => void;
}) {
  return (
    <div className="empty">
      <section className="empty__card" aria-labelledby="empty-title">
        <span className="empty__tile" aria-hidden="true">
          A
        </span>
        <h1 className="empty__title" id="empty-title">
          Open a vault
        </h1>
        <p className="empty__body">
          Choose the folder that holds your markdown notes. Atlas works on the files where they are
          — nothing is imported, moved or converted.
        </p>
        <button className="btn btn--primary empty__action" type="button" onClick={onChooseVault}>
          Choose folder…
        </button>
        {onOpenFromGitHub !== undefined && (
          <button className="btn btn--ghost empty__action" type="button" onClick={onOpenFromGitHub}>
            Open a vault from GitHub…
          </button>
        )}
      </section>
    </div>
  );
}

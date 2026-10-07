/**
 * The dashboard's way into arranging it, in its head: "Customize" to start,
 * "Done" — the one accent on the page while it lasts — to stop.
 */
export function CustomizeToggle({
  arranging,
  onToggle,
}: {
  arranging: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`btn btn--sm ${arranging ? 'btn--primary' : 'btn--secondary'}`}
      onClick={onToggle}
    >
      {arranging ? 'Done' : 'Customize'}
    </button>
  );
}

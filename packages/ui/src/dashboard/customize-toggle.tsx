import { PageAction } from '../page-bar.tsx';
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
    <PageAction
      icon={arranging ? 'check' : 'gear'}
      label={arranging ? 'Done' : 'Customize'}
      tone={arranging ? 'primary' : 'secondary'}
      onPress={onToggle}
    />
  );
}

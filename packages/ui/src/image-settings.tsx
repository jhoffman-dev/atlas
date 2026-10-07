import type { ImagePlacement } from '@atlas/domain';
import { SegmentedControl, type SegmentedOption } from './segmented-control.tsx';
import { SettingsCard } from './settings-card.tsx';

const PLACEMENTS: readonly SegmentedOption<ImagePlacement>[] = [
  { value: 'attachments', label: 'Attachments folder' },
  { value: 'beside-note', label: 'Beside the note' },
];

/** The Images part of Settings: where an image pasted or dropped into a note is saved. */
export function ImageSettings({
  placement,
  onChange,
}: {
  placement: ImagePlacement;
  onChange: (placement: ImagePlacement) => void;
}) {
  return (
    <SettingsCard id="settings-images" icon="image" title="Images">
      <p className="settings__lede">
        An image pasted, dropped or picked into a note is copied into the vault, and the note links
        to the copy.
      </p>
      <div className="settings__row">
        <span className="settings__row-text">
          <span className="settings__row-label">Images go in</span>
          <span className="settings__status">
            {placement === 'attachments'
              ? 'attachments/, at the top of the vault'
              : 'The folder the note is in'}
          </span>
        </span>
        <SegmentedControl
          label="Images go in"
          options={PLACEMENTS}
          value={placement}
          onChange={onChange}
        />
      </div>
    </SettingsCard>
  );
}

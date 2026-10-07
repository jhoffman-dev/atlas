import { useState } from 'react';
import { ImageSettings } from '@atlas/ui';
import type { ImagePlacementStore } from '../notes/browser-image-placement-store.ts';

/** Settings → Images, wired to where the choice is kept. */
export function ImageSettingsPanel({ store }: { store: ImagePlacementStore }) {
  const [placement, setPlacement] = useState(() => store.read());
  return (
    <ImageSettings
      placement={placement}
      onChange={(chosen) => {
        store.write(chosen);
        setPlacement(chosen);
      }}
    />
  );
}

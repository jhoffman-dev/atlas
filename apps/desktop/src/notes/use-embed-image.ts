import { useCallback } from 'react';
import type { VaultPath } from '@atlas/domain';
import { embedImage, type ImageProbePort, type VaultFsPort } from '@atlas/application';
import type { EmbedImage } from '@atlas/ui';
import type { ImagePlacementStore } from './browser-image-placement-store.ts';

/** What saving an image into the vault needs from the app around it. */
export interface EmbedImagePorts {
  readonly fs: VaultFsPort;
  readonly probe: ImageProbePort;
  readonly placement: ImagePlacementStore;
  /** Local time, `YYYY-MM-DDTHH:mm:ss`. */
  readonly now: () => string;
  /** Told once an image is written, so the tree and the index see the new file. */
  readonly onSaved: () => void;
}

/**
 * Saves images pasted, dropped or picked into the note at `notePath`, as the
 * editor asks. Undefined when there is no note to put one in.
 */
export function useEmbedImage({
  ports,
  notePath,
}: {
  ports: EmbedImagePorts;
  notePath: VaultPath | null;
}): EmbedImage | undefined {
  const { fs, probe, placement, now, onSaved } = ports;
  const embed = useCallback<EmbedImage>(
    async (file, origin) => {
      if (notePath === null) throw new Error('There is no note to put the image in.');
      const saved = await embedImage({
        fs,
        probe,
        notePath,
        image: { name: file.name, mimeType: file.type, size: file.size, origin },
        readBytes: async () => new Uint8Array(await file.arrayBuffer()),
        placement: placement.read(),
        now: now(),
      });
      onSaved();
      return { src: saved.src, alt: saved.alt };
    },
    [fs, probe, placement, now, onSaved, notePath],
  );
  return notePath === null ? undefined : embed;
}

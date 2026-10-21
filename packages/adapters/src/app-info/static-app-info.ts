import type { AppInfoPort } from '@dfai/application';

/** Used when the UI runs in a plain browser (`pnpm dev`), where no Tauri runtime exists. */
export function staticAppInfo(value: {
  name: string;
  version: string;
  build: string | null;
}): AppInfoPort {
  return { read: () => Promise.resolve(value) };
}

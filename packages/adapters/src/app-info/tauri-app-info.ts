import { getName, getVersion } from '@tauri-apps/api/app';
import type { AppInfoPort } from '@atlas/application';

/**
 * Reads identity from the Tauri runtime, which sources it from tauri.conf.json.
 * The runtime does not know the commit, so the build hands it in.
 */
export function tauriAppInfo({ build }: { build: string | null }): AppInfoPort {
  return {
    async read() {
      const [name, version] = await Promise.all([getName(), getVersion()]);
      return { name, version, build };
    },
  };
}

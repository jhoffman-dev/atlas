import { getName, getVersion } from '@tauri-apps/api/app';
import type { AppInfoPort } from '@atlas/application';

/** Reads identity from the Tauri runtime, which sources it from tauri.conf.json. */
export const tauriAppInfo: AppInfoPort = {
  async read() {
    const [name, version] = await Promise.all([getName(), getVersion()]);
    return { name, version };
  },
};

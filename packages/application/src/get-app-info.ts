import { createAppInfo, type AppInfo } from '@dfai/domain';
import type { AppInfoPort } from './ports.ts';

/** Reads identity from the host and validates it against the domain rules. */
export async function getAppInfo({ appInfo }: { appInfo: AppInfoPort }): Promise<AppInfo> {
  return createAppInfo(await appInfo.read());
}

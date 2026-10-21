import type { AppInfo } from '@atlas/domain';
import { SettingsSection } from './settings-section.tsx';
import { SETTINGS_SECTIONS } from './settings-section-links.ts';

export type AppInfoState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly info: AppInfo }
  | { readonly kind: 'failed'; readonly message: string };

/** The About part of Settings: which version this is, and the commit it was built from (#481). */
export function AboutSettings({ app }: { app: AppInfoState }) {
  return (
    <SettingsSection section={SETTINGS_SECTIONS.about}>
      {app.kind === 'ready' && (
        <>
          <p className="settings__file">
            {app.info.name} {app.info.version}
          </p>
          {app.info.build !== null && <p className="settings__file">Build {app.info.build}</p>}
        </>
      )}
      {app.kind === 'failed' && (
        <p className="settings__problem" role="alert">
          {app.message}
        </p>
      )}
    </SettingsSection>
  );
}

import {
  globalCaptureSettings,
  googleCalendarSettingsCard,
  granolaSettingsCard,
  imageSettingsPanel,
  profileSettingsCard,
  quickAddSettingsCard,
  secretsSettingsCard,
  syncSettingsCard,
} from '../pages-on-first-use.ts';

/*
 * The sections `app.tsx` hands to Settings, loaded on first use, under the
 * names it draws them by. They are drawn inside `SettingsPanel`'s `Suspense`.
 */
export const GlobalCaptureSettings = globalCaptureSettings.Component;
export const GoogleCalendarSettingsCard = googleCalendarSettingsCard.Component;
export const GranolaSettingsCard = granolaSettingsCard.Component;
export const ImageSettingsPanel = imageSettingsPanel.Component;
export const ProfileSettingsCard = profileSettingsCard.Component;
export const QuickAddSettingsCard = quickAddSettingsCard.Component;
export const SecretsSettingsCard = secretsSettingsCard.Component;
export const SyncSettingsCard = syncSettingsCard.Component;

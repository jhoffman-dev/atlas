import type { ComponentType } from 'react';
import type * as LaterParts from './later-parts.ts';
import { onFirstUse, type OnFirstUse } from './on-first-use.ts';

/*
 * The pages and parts that are not on the start path, split into chunks that
 * are fetched the first time one is drawn, or once the app has loaded
 * (`preloadPages`). Today, the Inbox, the note editor, the sidebar and the
 * shell stay in the main chunk: they are what start-up shows. Each must be
 * drawn inside a `Suspense`.
 */

/** Every part's preload, in the order declared. */
const PRELOADS: (() => Promise<void>)[] = [];

function later<P extends object>(load: () => Promise<ComponentType<P>>): OnFirstUse<P> {
  const part = onFirstUse(load);
  PRELOADS.push(part.preload);
  return part;
}

/** A part of `later-parts.ts`, which shares one chunk with the rest of them. */
const laterPart = <P extends object>(pick: (parts: typeof LaterParts) => ComponentType<P>) =>
  later(() => import('./later-parts.ts').then(pick));

// The pages over the panes (`main-route.tsx`).
export const graphPage = later(() => import('./graph/graph-page.tsx').then((m) => m.default));
export const typePage = later(() => import('./types/type-page.tsx').then((m) => m.TypePage));
export const queryScreen = later(() =>
  import('./query/query-screen.tsx').then((m) => m.QueryScreen),
);
export const tagsScreen = later(() => import('./tags/tags-screen.tsx').then((m) => m.TagsScreen));
export const automationsScreen = later(() =>
  import('./automations/automations-screen.tsx').then((m) => m.AutomationsScreen),
);
export const activityScreen = later(() =>
  import('./activity/activity-screen.tsx').then((m) => m.ActivityScreen),
);
export const archivePage = laterPart((m) => m.ArchivePage);
export const weeklyReviewPage = laterPart((m) => m.WeeklyReviewPage);
export const templatesPage = laterPart((m) => m.TemplatesPage);
export const termsPage = laterPart((m) => m.TermsPage);

// What a note pane draws for a dashboard, an artifact, or a view's rarer layouts.
export const dashboardView = laterPart((m) => m.DashboardView);
export const widgetEditor = laterPart((m) => m.WidgetEditor);
export const artifactViewer = laterPart((m) => m.ArtifactViewer);
export const calendarView = laterPart((m) => m.CalendarView);
export const timelineView = laterPart((m) => m.TimelineView);
export const feedView = laterPart((m) => m.FeedView);

// Claude's panel, and Settings: the dialog draws its sections inside its own `Suspense`.
export const chatPanel = laterPart((m) => m.ChatPanel);
export const claudeSettings = laterPart((m) => m.ClaudeSettings);
export const settingsDialog = laterPart((m) => m.SettingsDialog);
// The sections `app.tsx` hands to Settings, under the names it draws them by.
export const GlobalCaptureSettings = laterPart((m) => m.GlobalCaptureSettings).Component;
export const GoogleCalendarSettingsCard = laterPart((m) => m.GoogleCalendarSettingsCard).Component;
export const GranolaSettingsCard = laterPart((m) => m.GranolaSettingsCard).Component;
export const ImageSettingsPanel = laterPart((m) => m.ImageSettingsPanel).Component;
export const ProfileSettingsCard = laterPart((m) => m.ProfileSettingsCard).Component;
export const QuickAddSettingsCard = laterPart((m) => m.QuickAddSettingsCard).Component;
export const SecretsSettingsCard = laterPart((m) => m.SecretsSettingsCard).Component;
export const SyncSettingsCard = laterPart((m) => m.SyncSettingsCard).Component;

/**
 * Fetches every part's chunk, so that one drawn later appears at once, with no
 * fallback. Resolves when all have settled: a chunk that fails to load is left
 * to the part that needs it, which fails where it is drawn.
 */
export async function preloadPages(): Promise<void> {
  await Promise.allSettled(PRELOADS.map((preload) => preload()));
}

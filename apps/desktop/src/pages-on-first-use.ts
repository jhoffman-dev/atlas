import type { ComponentType } from 'react';
import type * as LaterParts from './later-parts.ts';
import { onFirstUse, type FailedPartProps, type OnFirstUse } from './on-first-use.ts';
import type { PageChrome } from './page-frame-fallback.tsx';
import { PageFailed, PartFailed } from './part-failed.tsx';

/*
 * The pages and parts that are not on the start path, split into chunks that
 * are fetched the first time one is drawn, or once the app has loaded
 * (`preloadPages`). Today, the Inbox, the note editor, the sidebar and the
 * shell stay in the main chunk: they are what start-up shows. Each must be
 * drawn inside a `Suspense`.
 */

/** Every part's preload, in the order declared. */
const PRELOADS: (() => Promise<void>)[] = [];

/** A part that, when its chunk cannot be loaded, says so where it would have been. */
function later<P extends object>(
  load: () => Promise<ComponentType<P>>,
  Failed: ComponentType<FailedPartProps<P>> = PartFailed,
): OnFirstUse<P> {
  const part = onFirstUse(load, Failed);
  PRELOADS.push(part.preload);
  return part;
}

/** A page over the panes: when its chunk cannot be loaded, it says so inside its frame. */
const laterPage = <P extends PageChrome>(load: () => Promise<ComponentType<P>>) =>
  later(load, PageFailed);

const fromLaterParts = <P extends object>(pick: (parts: typeof LaterParts) => ComponentType<P>) =>
  import('./later-parts.ts').then(pick);

/** A part of `later-parts.ts`, which shares one chunk with the rest of them. */
const laterPart = <P extends object>(pick: (parts: typeof LaterParts) => ComponentType<P>) =>
  later(() => fromLaterParts(pick));

/** A page in `later-parts.ts`. */
const laterPartPage = <P extends PageChrome>(
  pick: (parts: typeof LaterParts) => ComponentType<P>,
) => laterPage(() => fromLaterParts(pick));

// The pages over the panes (`main-route.tsx`).
export const graphPage = laterPage(() => import('./graph/graph-page.tsx').then((m) => m.default));
export const typePage = laterPage(() => import('./types/type-page.tsx').then((m) => m.TypePage));
export const queryScreen = laterPage(() =>
  import('./query/query-screen.tsx').then((m) => m.QueryScreen),
);
export const tagsScreen = laterPage(() =>
  import('./tags/tags-screen.tsx').then((m) => m.TagsScreen),
);
export const automationsScreen = laterPage(() =>
  import('./automations/automations-screen.tsx').then((m) => m.AutomationsScreen),
);
export const activityScreen = laterPage(() =>
  import('./activity/activity-screen.tsx').then((m) => m.ActivityScreen),
);
export const archivePage = laterPartPage((m) => m.ArchivePage);
export const weeklyReviewPage = laterPartPage((m) => m.WeeklyReviewPage);
export const templatesPage = laterPartPage((m) => m.TemplatesPage);
export const termsPage = laterPartPage((m) => m.TermsPage);

// What a note pane draws for a dashboard, an artifact, or a view's rarer layouts.
export const dashboardView = laterPart((m) => m.DashboardView);
export const widgetEditor = laterPart((m) => m.WidgetEditor);
export const artifactViewer = laterPart((m) => m.ArtifactViewer);
export const calendarView = laterPart((m) => m.CalendarView);
export const timelineView = laterPart((m) => m.TimelineView);
export const feedView = laterPart((m) => m.FeedView);

// Claude's panel, and Settings: `SettingsPanel` draws the dialog and its sections in one `Suspense`.
export const chatPanel = laterPart((m) => m.ChatPanel);
export const claudeSettings = laterPart((m) => m.ClaudeSettings);
export const settingsDialog = laterPart((m) => m.SettingsDialog);
// The sections `app.tsx` hands to Settings (drawn by name from `settings/settings-sections.ts`).
export const globalCaptureSettings = laterPart((m) => m.GlobalCaptureSettings);
export const googleCalendarSettingsCard = laterPart((m) => m.GoogleCalendarSettingsCard);
export const granolaSettingsCard = laterPart((m) => m.GranolaSettingsCard);
export const imageSettingsPanel = laterPart((m) => m.ImageSettingsPanel);
export const profileSettingsCard = laterPart((m) => m.ProfileSettingsCard);
export const quickAddSettingsCard = laterPart((m) => m.QuickAddSettingsCard);
export const secretsSettingsCard = laterPart((m) => m.SecretsSettingsCard);
export const syncSettingsCard = laterPart((m) => m.SyncSettingsCard);

/**
 * Runs every preload and waits for all of them to settle. One that rejects is
 * warned about rather than thrown: the part it belongs to deals with its own
 * chunk where it is drawn.
 */
export async function preloadAll(preloads: readonly (() => Promise<void>)[]): Promise<void> {
  const settled = await Promise.allSettled(preloads.map((preload) => preload()));
  for (const result of settled) {
    if (result.status === 'rejected')
      console.warn('A part of Atlas could not preload:', result.reason);
  }
}

/**
 * Fetches every part's chunk, so that one drawn later appears at once, with no
 * fallback. A chunk that cannot be loaded is warned about, and its part offers
 * to load it again where it is drawn.
 */
export const preloadPages = (): Promise<void> => preloadAll(PRELOADS);

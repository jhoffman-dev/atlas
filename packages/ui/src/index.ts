export { AppShell } from './app-shell.tsx';
export { IndexSettings, indexStatusText } from './index-status.tsx';
export { ImageSettings } from './image-settings.tsx';
export { GlobalCaptureSettings } from './global-capture-settings.tsx';
export type { GlobalCaptureView } from './global-capture-settings.tsx';
export type { AppInfoState, IndexSummary } from './index-status.tsx';
export { VaultTree } from './vault-tree.tsx';
export type { TreeEditing } from './vault-tree.tsx';
export { Sidebar } from './sidebar.tsx';
export type {
  ActivityRowLink,
  InboxRowLink,
  HeaderMenu,
  SidebarQuickView,
  SidebarTree,
  SidebarType,
} from './sidebar.tsx';
export type { MenuCommand } from './menu-items.tsx';
export { MovePicker } from './move-picker.tsx';
export type { MoveDestination } from './move-picker.tsx';
export { DeleteDialog } from './delete-dialog.tsx';
export type { DeletionSubject } from './delete-dialog.tsx';
export { SidebarFooter } from './sidebar-footer.tsx';
export { Icon } from './icon.tsx';
export type { IconName } from './icon.tsx';
export { FavoriteStar } from './favorite-star.tsx';
export { useSidebarSections } from './sidebar-sections.ts';
export type { SectionOrder, SectionStore } from './sidebar-sections.ts';
export { NotePane } from './note-pane.tsx';
export { PaneFrame } from './pane-frame.tsx';
export type { NotePaneState, PageHeading, PaneArrangement } from './note-pane.tsx';
export type { OverlaySlot, OverlaySlots } from './overlay-slot.ts';
export { NoteEditor } from './note-editor.tsx';
export type {
  NoteBookmarks,
  NoteEditorHandle,
  NotePeople,
  NoteQueryBlocks,
  NoteReveal,
  NoteTransclusions,
} from './note-editor.tsx';
export type { QueryBlockRows, QueryBlockShown } from './editor/query-block.tsx';
export type { BlockChoices, BlockPicking } from './editor/block-picking.ts';
export type { BookmarkPreview } from './bookmark-card.tsx';
export type { EmbedImage, ImageOrigin, SavedImage } from './editor/image-uploads.ts';
export { LinkPicker } from './link-picker.tsx';
export { VaultEmptyState } from './vault-empty.tsx';
export { NoteLinksPanel } from './note-links.tsx';
export type { MentionRow, MentionsState } from './note-links.tsx';
export { EditableTitle, PageHead } from './page-head.tsx';
export type { PageHeadProps } from './page-head.tsx';
export { PageBar } from './page-bar.tsx';
export type { PageHistory, PageMenuItem } from './page-bar.tsx';
export { SearchPalette } from './search-palette.tsx';
export { VaultHeader } from './vault-header.tsx';
export type { TemplateChoice } from './vault-header.tsx';
export { PropertiesPanel } from './properties-panel.tsx';
export type {
  CreateRelated,
  NewProperty,
  PropertyRow,
  RelationChoice,
} from './properties-panel.tsx';
export { TableView } from './table-view.tsx';
export type { TableResult, TableSchema } from './table-view.tsx';
export type { TableGrouping } from './grouped-rows.tsx';
export { BoardView } from './board-view.tsx';
export type { CardAdd, CardMove } from './board-view.tsx';
export type { GroupFolds, GroupFoldStore } from './group-folds.ts';
export { GalleryView, ListView } from './list-view.tsx';
export { FeedView } from './feed-view.tsx';
export type { FeedBodies } from './feed-view.tsx';
export type { CoverSource } from './card-cover.tsx';
export type { DoneTicks } from './done-checkbox.tsx';
export { LayoutMenu } from './layout-menu.tsx';
export { CapturePalette } from './capture-palette.tsx';
export { CalendarView } from './calendar-view.tsx';
export type { CalendarWrite } from './calendar-view.tsx';
export type { PlanDrop, Planner } from './schedule-tray.tsx';
export { CalendarNav, useCalendarNav } from './calendar-nav.tsx';
export type { CalendarNavigation } from './calendar-nav.tsx';
export { DashboardView } from './dashboard-view.tsx';
export type { DashboardEditing } from './dashboard-view.tsx';
export { CustomizeToggle } from './dashboard/customize-toggle.tsx';
export { WidgetEditor } from './dashboard/widget-editor.tsx';
export type { EditorChoice, WidgetEditorProps } from './dashboard/widget-editor.tsx';
export { TimelineView } from './timeline-view.tsx';
export { SourcePanel } from './source-panel.tsx';
export { SecretsSettings } from './secrets-settings.tsx';
export type { SecretRow, SecretSave } from './secrets-settings.tsx';
export { GoogleCalendarSettings } from './google-calendar-settings.tsx';
export type {
  GoogleCalendarChoice,
  GoogleCalendarPhase,
  GoogleCalendarProblem,
  GoogleCalendarView,
  GoogleConnectRequest,
} from './google-calendar-settings.tsx';
export { Toggle } from './toggle.tsx';
export { SegmentedControl } from './segmented-control.tsx';
export { TagsPage } from './tags-page.tsx';
export type { TaggedNotesState, TagTreeState } from './tags-page.tsx';
export type { TagRenameControls, TagRenameState } from './tag-rename-form.tsx';
export type { SegmentedOption } from './segmented-control.tsx';
export { ThemeSwitch } from './theme-switch.tsx';
export { systemTheme, useTheme } from './theme.ts';
export type { Theme, ThemeStore } from './theme.ts';
export { SettingsDialog } from './settings-dialog.tsx';
export type { ConnectionSettingsState } from './settings-dialog.tsx';
export { ArchivedButton, ViewToolbar } from './view-toolbar.tsx';
export { ViewTabs } from './view-tabs.tsx';
export type { ViewTabEditing } from './view-tabs.tsx';
export type { ArchivedToggle, SelectToggle, ViewField, ViewToolbarProps } from './view-toolbar.tsx';
export { NewTypeDialog } from './new-type-dialog.tsx';
export { TypeEditor } from './type-editor.tsx';
export type {
  RelationTarget,
  TypeDeletion,
  TypeEditorNotice,
  TypeEditorPrompt,
} from './type-editor.tsx';
export { NewViewDialog } from './new-view-dialog.tsx';
export type { NewViewChoice } from './new-view-dialog.tsx';
export { ViewSaveControls } from './view-save-controls.tsx';
export { GroupByPopover, PropertiesPopover } from './view-settings-popovers.tsx';
export type { GroupOption } from './view-settings-popovers.tsx';
export { QueryPage } from './query-page.tsx';
export type { AddToDashboard, QueryChoice, QueryPageProps, SaveAsView } from './query-page.tsx';
export { LinkedNote, NoteNamesProvider, useNoteNames } from './note-names.tsx';
export { ArtifactViewer, ARTIFACT_SANDBOX } from './artifact-viewer.tsx';
export type { ArtifactViewerCopy } from './artifact-viewer.tsx';
export { ArtifactCardFace } from './artifact-card-face.tsx';
export { ThumbnailValue } from './thumbnail-value.tsx';
export { NewArtifactDialog, LINK_ONLY_NOTE, artifactKindGlyph } from './new-artifact-dialog.tsx';
export type { ArtifactChoice, NewArtifactDraft } from './new-artifact-dialog.tsx';
export { FileDrop } from './file-drop.tsx';
export { FloatingAddButton } from './fab.tsx';
export type { FabAnchorStore, FabItem } from './fab.tsx';
export { QuickAddPopover } from './quick-add-popover.tsx';
export type { QuickAddRequest } from './quick-add-popover.tsx';
export { QuickAddSettings } from './quick-add-settings.tsx';
export { ProfileSettings } from './profile-settings.tsx';
export type { QuickAddRow } from './quick-add-settings.tsx';
export { Toast } from './toast.tsx';
export { sidebarGlyph } from './icon.tsx';
export { createNotePageRenderer, notePageStyles } from './note-page-renderer.ts';
export type { NotePageRendering } from './note-page-renderer.ts';
export { ArchivePage } from './archive-page.tsx';
export { InboxPage } from './inbox-page.tsx';
export { TaskScheduleSummary } from './task-schedule.tsx';
export { TemplatesPage } from './templates-page.tsx';
export { TermsPage } from './terms-page.tsx';
export type { NewTerm, TermsContents, TermsPageProps } from './terms-page.tsx';
export type { TemplateLessType, TemplateListing, TemplatesPageProps } from './templates-page.tsx';
export { TemplateBanner } from './template-banner.tsx';
export { PromotionBanner } from './promotion-notice.tsx';
export type { LinePromotion, PromotionNotice } from './promotion-notice.tsx';
export type { PromotedLine, PromoteLine } from './editor/promote-line.ts';
export { TemplateToNoteDialog } from './template-to-note-dialog.tsx';
export type { TemplateNotice } from './template-banner.tsx';
export { lostUsesText, TEMPLATE_EXPLANATION, templateUsesText } from './template-words.ts';
export type { ArchiveContents, ArchivePageProps } from './archive-page.tsx';
export type { InboxContents, InboxPageProps, InboxTypesOffer } from './inbox-page.tsx';
export { WeeklyReviewPage } from './weekly-review-page.tsx';
export type { WeeklyReviewPageProps } from './weekly-review-page.tsx';
export { TaskMigration } from './task-migration.tsx';
export type {
  TaskMigrationMapping,
  TaskMigrationPreviewData,
  TaskMigrationProps,
  TaskMigrationRow,
} from './task-migration.tsx';
export { SelectAllBox, SelectBox, SelectionBar } from './row-selection.tsx';
export type { BulkAction, RowSelection } from './row-selection.tsx';
export * from './query-language/index.ts';
export * from './automations/index.ts';
export * from './proposals/index.ts';
export * from './activity/index.ts';
export type { Choice } from './choice-select.tsx';
export { ChatPanel } from './chat/chat-panel.tsx';
export type { ChatNameHint } from './chat/chat-panel.tsx';
export { ChatToggleButton, ChatToggleProvider } from './chat/chat-toggle.tsx';
export type { ChatToggle } from './chat/chat-toggle.tsx';
export type {
  ChatActions,
  ChatHistoryView,
  ChatItemView,
  ChatPanelState,
  ChatProblemView,
  ProposalView,
} from './chat/chat-view.ts';
export { ClaudeSettings } from './chat/claude-settings.tsx';
export type { ClaudeProviderChoice } from './chat/claude-settings.tsx';
export { SyncSettings } from './sync/sync-settings.tsx';
export type { SyncSettingsActions, SyncSettingsView, SyncTone } from './sync/sync-settings.tsx';
export { SyncIndicator } from './sync/sync-indicator.tsx';
export { RepositoryPicker } from './sync/repository-picker.tsx';
export type { RepositoryChoice, RepositoryListView } from './sync/repository-picker.tsx';
export { OpenFromGitHubDialog } from './sync/open-from-github-dialog.tsx';

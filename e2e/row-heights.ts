/**
 * The heights the virtualised lists place a row by until it is measured —
 * what WebKit draws under the system font (UI v2, #269) — in one place, so a
 * spec that pins one reads the same number as every other:
 *
 *   packages/ui/src/today-page.tsx        GROUP_NAME_HEIGHT, GROUP_NAME_GAP,
 *                                         GROUP_GAP, ROW_HEIGHT, TABLE_EDGE
 *   packages/ui/src/inbox/inbox-rows.tsx  ROW_HEIGHT
 *   packages/ui/src/grouped-rows.tsx      LINE_HEIGHT (row, group, new)
 *
 * A font or padding change moves the constant here with it, and
 * row-estimates.spec.ts holds each to what the page draws.
 */

/** A Today group's name line: 12px/600, never a second line. */
export const GROUP_NAME_HEIGHT = 18;
/** The rest of a named Today group placed after another: the gap above it, the room under its name, and the half of its last row's collapsed 1px border that lies outside the table. */
export const TODAY_GROUP_GAP = 12;
export const TODAY_GROUP_NAME_GAP = 4;
export const TODAY_TABLE_EDGE = 0.5;
/** The table view's row, which Today's and the review's rows are since UI v2 slice 13a. */
export const TODAY_ROW_HEIGHT = 34;
export const INBOX_ROW_HEIGHT = 59;
export const TABLE_ROW_HEIGHT = 34;
export const TABLE_GROUP_HEIGHT = 32;
export const TABLE_NEW_HEIGHT = 30;
/** The table's sticky header, which `scroll-padding-top` must clear (#244). */
export const TABLE_HEADER_HEIGHT = 32;

/*
 * Google Docs from an export (#501), through the Calendar's sign-in
 * (ADR-0030). The one scope added is the narrowest Drive has: the files this
 * app made itself, and no other file in the person's Drive. Google lists it
 * as non-sensitive, so a client needs no verification to ask for it.
 */

export const GOOGLE_DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** What a Google Doc is, to Drive: an upload converted to it becomes an editable Doc. */
export const GOOGLE_DOC_MIME_TYPE = 'application/vnd.google-apps.document';

/** What a folder is, to Drive. */
export const GOOGLE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

/**
 * The most HTML one Doc is made from. Google converts a file to a Doc only
 * up to 50 MB; this leaves room for the request around it.
 */
export const MAX_GOOGLE_DOC_HTML_BYTES = 45 * 1024 * 1024;

/**
 * The scopes to sign in with so Drive can be reached: those already granted
 * and the Drive one — asked for once, on top of what the person allowed
 * before, so connecting for an export never takes the Calendar's away.
 * Null when they already include it.
 */
export function scopesWithDrive(granted: readonly string[]): string[] | null {
  if (granted.includes(GOOGLE_DRIVE_FILE_SCOPE)) return null;
  return [...granted, GOOGLE_DRIVE_FILE_SCOPE];
}

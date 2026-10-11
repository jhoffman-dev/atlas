import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapMeeting, MeetingMappingError, type MeetingFields } from '@atlas/domain';
import {
  decodeBase64,
  existingFileText,
  sameMeeting,
  sameMeetingAtOtherPath,
} from './github-file.ts';

/*
 * The workflow's GitHub branch: whether the file already at a meeting's path
 * is that meeting. All names here are made up.
 */

const GEMINI: MeetingFields = {
  title: 'Platform weekly sync',
  date: '2026-10-06',
  start: '10:00',
  source: 'gemini',
  sourceId: 'fake-meeting-0001',
};

describe('recognising a meeting already in the repository', () => {
  const file = mapMeeting(GEMINI);

  it('is the same meeting when provider and external_id match, however they are quoted', () => {
    expect(sameMeeting(file.content, file)).toBe(true);
    const doubleQuoted = '---\nprovider: "gemini"\nexternal_id: "fake-meeting-0001"\n---\n';
    const bare = '---\r\nprovider: gemini\r\nexternal_id: fake-meeting-0001\r\n---\r\n';
    expect(sameMeeting(doubleQuoted, file)).toBe(true);
    expect(sameMeeting(bare, file)).toBe(true);
  });

  it('is another meeting when the id or provider differs, or there is no frontmatter', () => {
    expect(sameMeeting(mapMeeting({ ...GEMINI, sourceId: 'other' }).content, file)).toBe(false);
    expect(sameMeeting(mapMeeting({ ...GEMINI, source: 'granola' }).content, file)).toBe(false);
    expect(sameMeeting('# just a note\nprovider: gemini', file)).toBe(false);
    expect(sameMeeting("---\nprovider: 'gemini'\n---\n", file)).toBe(false);
  });

  const asGitHub = (text: string) => ({
    content: Buffer.from(text, 'utf8').toString('base64'),
    size: Buffer.byteLength(text),
  });

  it('reads the file GitHub returned, or refuses to guess when it sent no content', () => {
    expect(existingFileText(asGitHub(file.content))).toBe(file.content);
    expect(existingFileText({ content: '', size: 0 })).toBe('');
    // GitHub's contents API sends `content: ""` (encoding "none") for a file over 1 MB.
    expect(() => existingFileText({ content: '', encoding: 'none', size: 1_048_577 })).toThrow(
      MeetingMappingError,
    );
    expect(() => existingFileText({})).toThrow(/cannot read the file/);
  });

  it('confirms the file at the collision path is this meeting, or says another holds both', () => {
    expect(sameMeetingAtOtherPath(asGitHub(file.content), file)).toBe(true);
    const other = mapMeeting({ ...GEMINI, sourceId: 'fake-meeting-0002' }).content;
    expect(() => sameMeetingAtOtherPath(asGitHub(other), file)).toThrow(
      /another meeting .*both paths/,
    );
  });

  describe('decoding with what n8n’s JavaScript has', () => {
    afterEach(() => vi.unstubAllGlobals());
    const encoded = Buffer.from(file.content, 'utf8').toString('base64');

    it('uses Buffer, which n8n documents, when there is no atob', () => {
      vi.stubGlobal('atob', undefined);
      vi.stubGlobal('TextDecoder', undefined);
      expect(decodeBase64(encoded)).toBe(file.content);
    });

    it('falls back to atob and TextDecoder when there is no Buffer', () => {
      vi.stubGlobal('Buffer', undefined);
      expect(decodeBase64(encoded)).toBe(file.content);
    });
  });

  it('reads a file as the GitHub API returns it, base64 with line breaks', () => {
    const encoded = Buffer.from(file.content, 'utf8')
      .toString('base64')
      .replace(/(.{60})/g, '$1\n');
    expect(decodeBase64(encoded)).toBe(file.content);
    expect(sameMeeting(decodeBase64(encoded), file)).toBe(true);
  });
});

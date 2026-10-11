import { describe, expect, it } from 'vitest';
import { duplicateLink, withLinesAfterContract } from './meeting-stamp.ts';

describe('withLinesAfterContract', () => {
  const BLOCK = "---\ntype: meeting\natlas_import: meeting/v1\ntitle: 'Standup'\n---\n";

  it('puts the lines right after the contract line, every other byte as it was', () => {
    expect(withLinesAfterContract(BLOCK, 'atlas_import_outcome: imported\n')).toBe(
      "---\ntype: meeting\natlas_import: meeting/v1\natlas_import_outcome: imported\ntitle: 'Standup'\n---\n",
    );
  });

  it('keeps Windows line ends as they are, and never takes a longer key for the contract', () => {
    expect(
      withLinesAfterContract(
        '---\r\natlas_import_outcome: error\r\natlas_import: meeting/v1\r\n---\r\n',
        'x: 1\n',
      ),
    ).toBe('---\r\natlas_import_outcome: error\r\natlas_import: meeting/v1\r\nx: 1\n---\r\n');
  });

  it('is null for a block that names no contract', () => {
    expect(withLinesAfterContract('---\ntype: meeting\n---\n', 'x: 1\n')).toBeNull();
    expect(withLinesAfterContract('---\n  atlas_import: meeting/v1\n---\n', 'x: 1\n')).toBeNull();
  });
});

describe('duplicateLink', () => {
  it('links the original by its path, whatever else shares its name', () => {
    expect(duplicateLink('Inbox/Meetings/2026-10-06 Standup.md')).toBe(
      '[[Inbox/Meetings/2026-10-06 Standup]]',
    );
    expect(duplicateLink('Archive/Projects/Retro.markdown')).toBe('[[Archive/Projects/Retro]]');
  });
});

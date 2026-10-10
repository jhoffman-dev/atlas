import { describe, expect, it } from 'vitest';
import { readCsv } from './notion-csv.ts';
import { readNotionPage } from './notion-page.ts';
import { pairRows, type ExportPage } from './row-pages.ts';

const page = (id: string, text: string): ExportPage => ({
  file: `Tasks/${id}.md`,
  id,
  page: readNotionPage(text),
});

const CSV = readCsv(
  '﻿Name,Status\nPlan the offsite,Later\nPlan the offsite,Ready\nNo page,Inbox\n',
);

describe('pairing rows with their pages', () => {
  it("pairs each row with the page of its title, telling namesakes apart by the row's properties", () => {
    const later = page('later', '# Plan the offsite\n\nStatus: Later\n');
    const ready = page('ready', '# Plan the offsite\n\nStatus: Ready\n');
    const { rows } = pairRows(CSV, [ready, later]);
    expect(rows.map((row) => (row.kind === 'paired' ? row.page.id : row.reason))).toEqual([
      'later',
      'ready',
      'no page in the export has its title',
    ]);
  });

  it('refuses to guess between namesakes the properties cannot tell apart', () => {
    const csv = readCsv('Name,Status\nPlan the offsite,Later\n');
    const { rows, leftOver } = pairRows(csv, [
      page('one', '# Plan the offsite\n\nStatus: Ready\n'),
      page('two', '# Plan the offsite\n\nStatus: Ready\n'),
    ]);
    expect(rows).toEqual([
      {
        kind: 'unpaired',
        title: 'Plan the offsite',
        reason: '2 pages share its title and properties: no telling which is this row',
      },
    ]);
    expect(leftOver.map((each) => each.id)).toEqual(['one', 'two']);
  });

  it('gives back the pages no row claimed', () => {
    const stray = page('stray', '# Stray\n');
    const { leftOver } = pairRows(CSV, [stray]);
    expect(leftOver).toEqual([stray]);
  });
});

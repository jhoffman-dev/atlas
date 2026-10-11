import { describe, expect, it } from 'vitest';
import { readCsv } from './notion-csv.ts';
import { readNotionPage } from './notion-page.ts';
import { pairRows, propertiesHold, type ExportPage } from './row-pages.ts';

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

  it('pairs a row with no title with a page Notion titled Untitled, its Date telling them apart', () => {
    const csv = readCsv('Name,Date\n,"October 7, 2026"\n,"October 6, 2026"\n');
    const { rows, leftOver } = pairRows(csv, [
      page('sixth', '# Untitled\n\nDate: October 6, 2026\n'),
      page('seventh', '# Untitled\n\nDate: October 7, 2026\n'),
      page('eighth', '# Untitled\n\nDate: October 8, 2026\n'),
    ]);
    expect(rows.map((row) => (row.kind === 'paired' ? row.page.id : row.reason))).toEqual([
      'seventh',
      'sixth',
    ]);
    expect(rows.map((row) => row.title)).toEqual(['', '']);
    expect(leftOver.map((each) => each.id)).toEqual(['eighth']);
  });

  it('refuses to guess between Untitled pages of the same Date for a row with no title', () => {
    const csv = readCsv('Name,Date\n,"October 7, 2026"\n');
    const { rows } = pairRows(csv, [
      page('one', '# Untitled\n\nDate: October 7, 2026\n'),
      page('two', '# Untitled\n\nDate: October 7, 2026\n'),
    ]);
    expect(rows).toEqual([
      {
        kind: 'unpaired',
        title: '',
        reason: '2 pages share its title and properties: no telling which is this row',
      },
    ]);
  });

  it("leaves a blank-title row unpaired when its own page is missing, rather than take another row's", () => {
    const csv = readCsv('Name,Date\n,"October 7, 2026"\n,"October 6, 2026"\n,"October 8, 2026"\n');
    const { rows, leftOver } = pairRows(csv, [
      page('seventh', '# Untitled\n\nDate: October 7, 2026\n'),
      page('eighth', '# Untitled\n\nDate: October 8, 2026\n'),
    ]);
    expect(rows.map((row) => (row.kind === 'paired' ? row.page.id : row.reason))).toEqual([
      'seventh',
      'no page in the export agrees with it: its title does not tell it apart',
      'eighth',
    ]);
    expect(leftOver).toEqual([]);
  });

  it('leaves a row unpaired when it shares its title with another row and its one page is not its', () => {
    const csv = readCsv('Name,Status\nPlan the offsite,Later\nPlan the offsite,Ready\n');
    const { rows, leftOver } = pairRows(csv, [
      page('ready', '# Plan the offsite\n\nStatus: Ready\n'),
    ]);
    expect(rows.map((row) => (row.kind === 'paired' ? row.page.id : row.reason))).toEqual([
      'no page in the export agrees with it: its title does not tell it apart',
      'ready',
    ]);
    expect(leftOver).toEqual([]);
  });

  it('pairs namesakes by what the page repeats of the row, though it lists labels the CSV has no column for and shows an email as a link', () => {
    const csv = readCsv(
      'Name,Email\nMara Quill,mara@larkspur.example\nMara Quill,mq@fenn.example\n',
    );
    const { rows } = pairRows(csv, [
      page(
        'first',
        '# Mara Quill\n\nEmail: mara@larkspur.example\nMeeting Notes: Sync (../x.md)\n',
      ),
      page(
        'second',
        '# Mara Quill\n\nEmail: mailto:mq@fenn.example\nMeeting Notes: Retro (../y.md)\n',
      ),
    ]);
    expect(rows.map((row) => (row.kind === 'paired' ? row.page.id : row.reason))).toEqual([
      'first',
      'second',
    ]);
  });

  it('does not take a page for a row whose other cells match but whose Date it contradicts', () => {
    const csv = readCsv('Name,Type,Date\n,Daily,"October 6, 2026"\n');
    const { rows } = pairRows(csv, [
      page('eighth', '# Untitled\n\nType: Daily\nDate: October 8, 2026\n'),
    ]);
    expect(rows.map((row) => row.kind)).toEqual(['unpaired']);
  });

  it('still takes the one page of a title no other row has, whatever its properties say', () => {
    const csv = readCsv('Name,Status\nPlan the offsite,Later\n');
    const { rows } = pairRows(csv, [page('only', '# Plan the offsite\n\nStatus: Ready\n')]);
    expect(rows.map((row) => row.kind)).toEqual(['paired']);
  });

  it('never pairs a row that has a title with an Untitled page', () => {
    const csv = readCsv('Name,Date\nPlan the offsite,"October 7, 2026"\n');
    const { rows } = pairRows(csv, [page('blank', '# Untitled\n\nDate: October 7, 2026\n')]);
    expect(rows).toEqual([
      {
        kind: 'unpaired',
        title: 'Plan the offsite',
        reason: 'no page in the export has its title',
      },
    ]);
  });
});

describe("whether a page's properties paragraph is its row's", () => {
  const row = new Map([
    ['Name', 'Hallway chat'],
    ['Tags', 'inbox'],
    ['Date', ''],
  ]);

  it('is so when the row has something under its labels and the page says the same', () => {
    expect(propertiesHold(row, readNotionPage('# Hallway chat\n\nTags:  inbox\n'))).toBe(true);
    expect(propertiesHold(row, readNotionPage('# Hallway chat\n\nJust words.\n'))).toBe(true);
  });

  it('is not so when the row has nothing there, or says otherwise', () => {
    expect(propertiesHold(row, readNotionPage('# Hallway chat\n\nDate: after lunch\n'))).toBe(
      false,
    );
    expect(propertiesHold(row, readNotionPage('# Hallway chat\n\nTags: inbox\nDate: x\n'))).toBe(
      false,
    );
    expect(propertiesHold(row, readNotionPage('# Hallway chat\n\nTags: later\n'))).toBe(false);
    expect(propertiesHold(row, readNotionPage('# Hallway chat\n\nDate:\n\nWords.\n'))).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRANOLA_TIME_ZONE,
  GRANOLA_PERIODIC_KEY,
  GRANOLA_TIME_ZONE_KEY,
  GRANOLA_WEBHOOK_KEY,
  MEETING_GROUP_ADDRESSES_KEY,
  parseGranolaSettings,
} from './granola-settings.ts';

describe('parseGranolaSettings', () => {
  it('reads every setting the vault gives', () => {
    expect(
      parseGranolaSettings({
        [GRANOLA_TIME_ZONE_KEY]: 'Europe/London',
        [GRANOLA_WEBHOOK_KEY]: true,
        [GRANOLA_PERIODIC_KEY]: false,
        [MEETING_GROUP_ADDRESSES_KEY]: ['eng@example.com', 'ops@example.com'],
      }),
    ).toEqual({
      timeZone: 'Europe/London',
      webhook: true,
      periodic: false,
      groupAddresses: ['eng@example.com', 'ops@example.com'],
    });
  });

  it('is n8n’s zone, no webhook, the timer on and no group addresses for a vault that says nothing', () => {
    expect(parseGranolaSettings({})).toEqual({
      timeZone: 'America/Los_Angeles',
      webhook: false,
      periodic: true,
      groupAddresses: [],
    });
    expect(DEFAULT_GRANOLA_TIME_ZONE).toBe('America/Los_Angeles');
  });

  it('keys are the ones the vault’s settings note spells', () => {
    expect([
      GRANOLA_TIME_ZONE_KEY,
      GRANOLA_WEBHOOK_KEY,
      GRANOLA_PERIODIC_KEY,
      MEETING_GROUP_ADDRESSES_KEY,
    ]).toEqual([
      'granola_time_zone',
      'granola_webhook',
      'granola_periodic',
      'meeting_group_addresses',
    ]);
  });

  it('trims the zone, and takes a blank or non-text one as unset', () => {
    expect(parseGranolaSettings({ [GRANOLA_TIME_ZONE_KEY]: '  Asia/Tokyo ' }).timeZone).toBe(
      'Asia/Tokyo',
    );
    for (const zone of ['', '   ', 7, null, ['Asia/Tokyo']]) {
      expect(parseGranolaSettings({ [GRANOLA_TIME_ZONE_KEY]: zone }).timeZone).toBe(
        DEFAULT_GRANOLA_TIME_ZONE,
      );
    }
  });

  it('turns the webhook on only for true itself, and the timer off only for false itself', () => {
    for (const value of ['true', 'yes', 1, null]) {
      expect(parseGranolaSettings({ [GRANOLA_WEBHOOK_KEY]: value }).webhook).toBe(false);
      expect(parseGranolaSettings({ [GRANOLA_PERIODIC_KEY]: value }).periodic).toBe(true);
    }
  });

  it('keeps the group addresses that are text, trimmed, and drops the rest', () => {
    expect(
      parseGranolaSettings({
        [MEETING_GROUP_ADDRESSES_KEY]: [' eng@example.com ', '', 4, null, 'ops@example.com'],
      }).groupAddresses,
    ).toEqual(['eng@example.com', 'ops@example.com']);
    expect(
      parseGranolaSettings({ [MEETING_GROUP_ADDRESSES_KEY]: 'eng@example.com' }).groupAddresses,
    ).toEqual([]);
  });
});

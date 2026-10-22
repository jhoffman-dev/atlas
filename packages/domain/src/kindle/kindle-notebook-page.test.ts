import { describe, expect, it } from 'vitest';
import { parseHtml } from './html-tree.ts';
import { asksToSignIn, checkKindlePage } from './kindle-notebook-page.ts';

const page = (status: number, html = '', redirectedTo: string | null = null) => ({
  status,
  html,
  redirectedTo,
});

describe('checkKindlePage', () => {
  it('reads a 2xx answer into a tree', () => {
    const checked = checkKindlePage(page(200, '<div id="x"></div>'));
    expect(checked.kind).toBe('page');
  });

  it('reads a redirect to any of Amazon’s /ap/ pages as a sign-in', () => {
    for (const to of [
      'https://www.amazon.com/ap/signin',
      'https://www.amazon.com/ap/mfa',
      'https://www.amazon.com/ap/cvf/request',
    ]) {
      expect(checkKindlePage(page(302, '', to))).toEqual({ kind: 'sign_in_required' });
    }
  });

  it('reads a redirect to Amazon’s robot check as a robot check, not a sign-in', () => {
    for (const to of [
      'https://www.amazon.com/errors/validateCaptcha',
      'https://read.amazon.com/errors/validateCaptcha',
    ]) {
      expect(checkKindlePage(page(302, '', to))).toEqual({ kind: 'robot_check' });
    }
  });

  it('reads the robot check’s own page as a robot check, even beside a sign-in form', () => {
    expect(
      checkKindlePage(
        page(200, '<form action="/errors/validateCaptcha"><input id="ap_email"></form>'),
      ),
    ).toEqual({ kind: 'robot_check' });
  });

  it('names another Amazon store’s notebook when the notebook is sent there', () => {
    for (const [to, store] of [
      ['https://read.amazon.co.uk/notebook', 'read.amazon.co.uk'],
      ['https://read.amazon.de/kp/notebook?asin=B0EXAMPLE1', 'read.amazon.de'],
      ['https://read.amazon.com.au/notebook', 'read.amazon.com.au'],
      ['https://READ.AMAZON.CO.JP/notebook', 'read.amazon.co.jp'],
    ] as const) {
      expect(checkKindlePage(page(302, '', to))).toEqual({ kind: 'unsupported_store', store });
    }
  });

  it('does not take a lookalike host for another store', () => {
    for (const to of [
      'https://read.amazon.com.evil.invalid/notebook',
      'https://read.amazon.co.uk.invalid/notebook',
      'https://readamazon.co.uk/notebook',
    ]) {
      expect(checkKindlePage(page(302, '', to))).toMatchObject({ kind: 'unrecognised' });
    }
  });

  it('refuses a page nested deeper than a page may, rather than read what is past it as missing', () => {
    const deep = '<div>'.repeat(300) + '<div id="kp-notebook-library"></div>';
    expect(checkKindlePage(page(200, deep))).toMatchObject({
      kind: 'unrecognised',
      reason: expect.stringMatching(/deeper/) as string,
    });
  });

  it('reads a redirect anywhere else, or to no readable address, as a page it does not know', () => {
    for (const to of ['https://www.amazon.com/gp/help', '/ap/signin', 'not a url']) {
      expect(checkKindlePage(page(302, '', to))).toEqual({
        kind: 'unrecognised',
        reason: 'Amazon sent the notebook somewhere else',
      });
    }
  });

  it('reads 401 as a sign-in, any other 4xx or 5xx as Amazon being unavailable', () => {
    expect(checkKindlePage(page(401))).toEqual({ kind: 'sign_in_required' });
    expect(checkKindlePage(page(403))).toEqual({ kind: 'unavailable', status: 403 });
    expect(checkKindlePage(page(500))).toEqual({ kind: 'unavailable', status: 500 });
  });

  it('reads a 1xx or a 3xx with nowhere to go as a page it does not know', () => {
    expect(checkKindlePage(page(304))).toMatchObject({ kind: 'unrecognised' });
    expect(checkKindlePage(page(199))).toMatchObject({ kind: 'unrecognised' });
  });

  it('reads a 200 that is Amazon’s sign-in page as a sign-in', () => {
    expect(checkKindlePage(page(200, '<input id="ap_password">'))).toEqual({
      kind: 'sign_in_required',
    });
  });
});

describe('asksToSignIn', () => {
  it('knows the sign-in form by its name or its action, and not the robot check, which is its own problem', () => {
    expect(asksToSignIn(parseHtml('<form name="signIn"></form>'))).toBe(true);
    expect(asksToSignIn(parseHtml('<form action="https://www.amazon.com/ap/signin?x=1">'))).toBe(
      true,
    );
    expect(asksToSignIn(parseHtml('<form action="/errors/validateCaptcha">'))).toBe(false);
    expect(asksToSignIn(parseHtml('<input id="ap_email">'))).toBe(true);
  });

  it('does not read a notebook page, or a form going elsewhere, as a sign-in', () => {
    expect(asksToSignIn(parseHtml('<form name="search" action="/s"></form>'))).toBe(false);
    expect(asksToSignIn(parseHtml('<form></form><div id="kp-notebook-library"></div>'))).toBe(
      false,
    );
    expect(asksToSignIn(parseHtml('<div name="signIn" id="email"></div>'))).toBe(false);
  });
});

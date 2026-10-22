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

  it('reads a redirect to any of Amazon’s /ap/ pages, or to its robot check, as a sign-in', () => {
    for (const to of [
      'https://www.amazon.com/ap/signin',
      'https://www.amazon.com/ap/mfa',
      'https://www.amazon.com/ap/cvf/request',
      'https://www.amazon.com/errors/validateCaptcha',
    ]) {
      expect(checkKindlePage(page(302, '', to))).toEqual({ kind: 'sign_in_required' });
    }
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
  it('knows the sign-in form by its name or its action, and the robot check by its action', () => {
    expect(asksToSignIn(parseHtml('<form name="signIn"></form>'))).toBe(true);
    expect(asksToSignIn(parseHtml('<form action="https://www.amazon.com/ap/signin?x=1">'))).toBe(
      true,
    );
    expect(asksToSignIn(parseHtml('<form action="/errors/validateCaptcha">'))).toBe(true);
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

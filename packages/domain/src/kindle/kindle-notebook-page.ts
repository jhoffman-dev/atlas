import { findAll, findFirst, parseHtml, withClass, withId, withTag } from './html-tree.ts';
import type { HtmlElement } from './html-tree.ts';
import type { KindlePageProblem, KindleRawPage } from './kindle-types.ts';

/**
 * What every notebook page is checked for before it is read: that Amazon
 * answered at all, and that it answered with the notebook rather than with
 * its sign-in page. The markers are the ones open-source notebook readers
 * key on; they are checked against fixtures made by hand, which must be
 * checked against a real page (#508).
 */

/** Amazon's sign-in, two-step and "verify it's you" pages live under `/ap/`. */
const SIGN_IN_PATH = /^\/ap\//;
/** A robot check: the remedy is the same as for a sign-in — open the window and answer it. */
const CAPTCHA_PATH = /\/errors\/validatecaptcha/i;

const UNAUTHORIZED = 401;

/** The page read into a tree, or why it cannot be read at all. */
export type CheckedPage = { readonly kind: 'page'; readonly tree: HtmlElement } | KindlePageProblem;

function pathOf(address: string): string | null {
  try {
    return new URL(address).pathname;
  } catch {
    // Not an absolute URL: there is no path to judge by, which the caller says.
    return null;
  }
}

function redirectProblem(redirectedTo: string): KindlePageProblem {
  const path = pathOf(redirectedTo);
  if (path !== null && (SIGN_IN_PATH.test(path) || CAPTCHA_PATH.test(path))) {
    return { kind: 'sign_in_required' };
  }
  return { kind: 'unrecognised', reason: 'Amazon sent the notebook somewhere else' };
}

function isSignInForm(element: HtmlElement): boolean {
  if (element.tag !== 'form') return false;
  if (element.attributes.get('name') === 'signIn') return true;
  const action = element.attributes.get('action') ?? '';
  return /\/ap\/signin/i.test(action) || CAPTCHA_PATH.test(action);
}

/** Whether the page asks the person to sign in, or to prove they are one. */
export function asksToSignIn(tree: HtmlElement): boolean {
  return (
    findFirst(tree, isSignInForm) !== null ||
    findFirst(tree, (element) => withId('ap_email')(element) || withId('ap_password')(element)) !==
      null
  );
}

/** Checks `page` is an answer that can be read, and reads it into a tree. */
export function checkKindlePage(page: KindleRawPage): CheckedPage {
  if (page.redirectedTo !== null) return redirectProblem(page.redirectedTo);
  if (page.status === UNAUTHORIZED) return { kind: 'sign_in_required' };
  if (page.status < 200 || page.status > 299) {
    return page.status >= 400
      ? { kind: 'unavailable', status: page.status }
      : { kind: 'unrecognised', reason: `Amazon answered ${page.status} with nowhere to go` };
  }
  const tree = parseHtml(page.html);
  if (asksToSignIn(tree)) return { kind: 'sign_in_required' };
  return { kind: 'page', tree };
}

/** The `value` of the first hidden input matching `matches`; null when there is none. */
export function inputValue(
  tree: HtmlElement,
  matches: (element: HtmlElement) => boolean,
): string | null {
  const input = findFirst(tree, (element) => withTag('input')(element) && matches(element));
  return input === null ? null : (input.attributes.get('value') ?? '').trim();
}

/** Every element with all of `classes`, under `tree`. */
export function allWithClass(tree: HtmlElement, ...classes: string[]): HtmlElement[] {
  return findAll(tree, withClass(...classes));
}

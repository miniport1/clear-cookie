import { describe, expect, it } from 'vitest';
import {
  buildCookieUrl,
  cookieMatchesTab,
  cookiesDiffer,
  parseTabContext,
  sortCookies,
  validateCookieDraft,
} from '../src/shared/cookie-service';
import { clampFontSize, DEFAULT_FONT_SIZE, MAX_FONT_SIZE, MIN_FONT_SIZE } from '../src/shared/storage';
import type { CookieDraft, CookieItem } from '../src/shared/types';

function makeDraft(overrides: Partial<CookieDraft> = {}): CookieDraft {
  return {
    name: 'sid',
    value: '123',
    domain: 'example.com',
    hostOnly: true,
    path: '/',
    secure: true,
    httpOnly: false,
    sameSite: 'lax',
    session: true,
    ...overrides,
  };
}

describe('cookie-service pure helpers', () => {
  it('parses supported and unsupported tab URLs', () => {
    expect(parseTabContext({ id: 7, url: 'https://github.com/test' })).toMatchObject({
      tabId: 7,
      hostname: 'github.com',
      origin: 'https://github.com',
      isSupported: true,
    });

    expect(parseTabContext({ id: 8, url: 'chrome://extensions' }).isSupported).toBe(false);
    expect(parseTabContext({ id: 9, url: 'about:debugging' }).isSupported).toBe(false);
  });

  it('builds cookie URLs correctly for leading dots and protocols', () => {
    expect(buildCookieUrl({ domain: '.example.com', path: '/app', secure: true }, 'http:')).toBe(
      'https://example.com/app',
    );
    expect(buildCookieUrl({ domain: 'localhost', path: 'api', secure: false }, 'http:')).toBe(
      'http://localhost/api',
    );
  });

  it('enforces RFC cookie prefix and SameSite=None rules', () => {
    expect(validateCookieDraft(makeDraft())).toBeNull();
    expect(validateCookieDraft(makeDraft({ name: '' }))).toContain('名称不能为空');
    expect(validateCookieDraft(makeDraft({ name: 'a=b' }))).toContain('不能包含');
    expect(validateCookieDraft(makeDraft({ name: '__Secure-id', secure: false }))).toContain(
      '__Secure-',
    );
    expect(
      validateCookieDraft(makeDraft({ name: '__Host-id', secure: true, path: '/sub' })),
    ).toContain('__Host-');
    expect(
      validateCookieDraft(makeDraft({ sameSite: 'no_restriction', secure: false })),
    ).toContain('SameSite');
    expect(
      validateCookieDraft(makeDraft({ session: false, expirationDate: undefined })),
    ).toContain('过期时间');
  });

  it('sorts cookies deterministically by name, domain, and path', () => {
    const items: CookieItem[] = [
      { ...makeDraft({ name: 'b', domain: 'a.com', path: '/' }) },
      { ...makeDraft({ name: 'a', domain: 'z.com', path: '/' }) },
      { ...makeDraft({ name: 'a', domain: 'a.com', path: '/b' }) },
      { ...makeDraft({ name: 'a', domain: 'a.com', path: '/a' }) },
    ];
    expect(sortCookies(items).map((c) => `${c.name}@${c.domain}${c.path}`)).toEqual([
      'a@a.com/a',
      'a@a.com/b',
      'a@z.com/',
      'b@a.com/',
    ]);
  });

  it('clamps font size safely within supported bounds', () => {
    expect(clampFontSize(undefined)).toBe(DEFAULT_FONT_SIZE);
    expect(clampFontSize('bad')).toBe(DEFAULT_FONT_SIZE);
    expect(clampFontSize(8)).toBe(MIN_FONT_SIZE);
    expect(clampFontSize(28)).toBe(MAX_FONT_SIZE);
    expect(clampFontSize(15.6)).toBe(16);
  });

  it('matches cookies to active tab hostname and container storeId accurately', () => {
    const tab = parseTabContext({ id: 1, url: 'https://gist.github.com/u', cookieStoreId: 'firefox-container-1' });
    const parentCookie: CookieItem = {
      ...makeDraft({ domain: '.github.com', hostOnly: false }),
      storeId: 'firefox-container-1',
    };
    const exactHostCookie: CookieItem = {
      ...makeDraft({ domain: 'github.com', hostOnly: true }),
      storeId: 'firefox-container-1',
    };
    const otherContainerCookie: CookieItem = {
      ...makeDraft({ domain: '.github.com', hostOnly: false }),
      storeId: 'firefox-container-2',
    };
    expect(cookieMatchesTab(parentCookie, tab)).toBe(true);
    expect(cookieMatchesTab(exactHostCookie, tab)).toBe(false);
    expect(cookieMatchesTab(otherContainerCookie, tab)).toBe(false);
  });

  it('detects differences between two cookie snapshots', () => {
    const a: CookieItem = { ...makeDraft({ value: 'v1' }) };
    const b: CookieItem = { ...makeDraft({ value: 'v1' }) };
    const c: CookieItem = { ...makeDraft({ value: 'v2' }) };
    expect(cookiesDiffer(a, b)).toBe(false);
    expect(cookiesDiffer(a, c)).toBe(true);
  });
});

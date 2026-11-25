import { describe, expect, it } from 'vitest';
import {
  buildCookieUrl,
  parseTabContext,
  sortCookies,
  validateCookieDraft,
} from '../src/shared/cookie-service';
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
});

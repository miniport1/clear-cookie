import { describe, expect, it } from 'vitest';
import {
  detectFormat,
  exportCookies,
  normalizeExpiration,
  normalizeSameSite,
  parseCookies,
} from '../src/shared/formats';
import type { CookieItem } from '../src/shared/types';

const SAMPLE_COOKIES: CookieItem[] = [
  {
    name: 'session_id',
    value: 'abc=123',
    domain: '.example.com',
    hostOnly: false,
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    session: false,
    expirationDate: 1900000000,
  },
  {
    name: 'theme',
    value: 'dark',
    domain: 'app.example.com',
    hostOnly: true,
    path: '/dashboard',
    secure: false,
    httpOnly: false,
    sameSite: 'strict',
    session: true,
  },
];

describe('formats', () => {
  it('round-trips JSON export and import', () => {
    const json = exportCookies(SAMPLE_COOKIES, 'json');
    expect(detectFormat(json)).toBe('json');

    const parsed = parseCookies(json, 'auto', 'https://app.example.com/dashboard');
    expect(parsed.format).toBe('json');
    expect(parsed.warnings).toHaveLength(0);
    expect(parsed.cookies).toHaveLength(2);
    expect(parsed.cookies[0]).toMatchObject({
      name: 'session_id',
      value: 'abc=123',
      domain: '.example.com',
      hostOnly: false,
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      session: false,
      expirationDate: 1900000000,
    });
    expect(parsed.cookies[1]).toMatchObject({
      name: 'theme',
      value: 'dark',
      hostOnly: true,
      session: true,
      sameSite: 'strict',
    });
  });

  it('normalizes single JSON object, millisecond timestamps, and SameSite aliases', () => {
    const raw = JSON.stringify({
      name: 'token',
      value: 'xyz',
      sameSite: 'None',
      expires: 1900000000000,
    });
    const parsed = parseCookies(raw, 'json', 'https://example.org/');
    expect(parsed.cookies).toHaveLength(1);
    expect(parsed.cookies[0]).toMatchObject({
      name: 'token',
      domain: 'example.org',
      sameSite: 'no_restriction',
      secure: true,
      expirationDate: 1900000000,
      session: false,
    });
  });

  it('round-trips Netscape format including #HttpOnly_ prefix', () => {
    const netscape = exportCookies(SAMPLE_COOKIES, 'netscape');
    expect(detectFormat(netscape)).toBe('netscape');
    expect(netscape).toContain('#HttpOnly_.example.com\tTRUE\t/\tTRUE\t1900000000\tsession_id\tabc=123');

    const parsed = parseCookies(netscape, 'auto', 'https://app.example.com/');
    expect(parsed.format).toBe('netscape');
    expect(parsed.cookies).toHaveLength(2);
    expect(parsed.cookies[0]).toMatchObject({
      name: 'session_id',
      domain: '.example.com',
      hostOnly: false,
      httpOnly: true,
      secure: true,
      expirationDate: 1900000000,
    });
    expect(parsed.cookies[1]).toMatchObject({
      name: 'theme',
      domain: 'app.example.com',
      hostOnly: true,
      httpOnly: false,
      session: true,
    });
  });

  it('parses Header string with optional Cookie: prefix and values containing =', () => {
    const header = 'Cookie: a=1; jwt=eyJ.abc==; empty=';
    expect(detectFormat(header)).toBe('header');

    const parsed = parseCookies(header, 'auto', 'https://api.example.com/');
    expect(parsed.cookies.map((c) => [c.name, c.value])).toEqual([
      ['a', '1'],
      ['jwt', 'eyJ.abc=='],
      ['empty', ''],
    ]);
    expect(parsed.cookies[0]?.domain).toBe('api.example.com');
    expect(parsed.cookies[0]?.secure).toBe(true);
  });

  it('exports Header string cleanly', () => {
    expect(exportCookies(SAMPLE_COOKIES, 'header')).toBe('session_id=abc=123; theme=dark');
  });

  it('handles normalizers and throws on empty or invalid JSON', () => {
    expect(normalizeSameSite('Lax')).toBe('lax');
    expect(normalizeSameSite('NONE')).toBe('no_restriction');
    expect(normalizeSameSite(undefined)).toBe('unspecified');
    expect(normalizeExpiration('0')).toBeUndefined();
    expect(normalizeExpiration(1700000000)).toBe(1700000000);

    expect(() => parseCookies('   ', 'auto', 'https://a.com')).toThrow();
    expect(() => parseCookies('{broken', 'json', 'https://a.com')).toThrow();
  });
});

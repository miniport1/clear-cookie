import { describe, expect, it } from 'vitest';
import { inspectCookieValue } from '../src/shared/inspector';

function toBase64Url(str: string): string {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('inspectCookieValue', () => {
  it('decodes JWT header, payload, and expiration state', () => {
    const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const payload = toBase64Url(JSON.stringify({ sub: 'u_42', role: 'admin', exp: futureExp }));
    const token = `${header}.${payload}.signature_part`;

    const res = inspectCookieValue(token);
    expect(res?.kind).toBe('jwt');
    if (res?.kind === 'jwt') {
      expect(res.expired).toBe(false);
      expect(res.payload).toContain('"role": "admin"');
      expect(res.header).toContain('"HS256"');
    }
  });

  it('marks expired JWT accurately', () => {
    const header = toBase64Url(JSON.stringify({ alg: 'RS256' }));
    const payload = toBase64Url(JSON.stringify({ exp: 1000000000 }));
    const res = inspectCookieValue(`${header}.${payload}.sig`);
    expect(res?.kind).toBe('jwt');
    if (res?.kind === 'jwt') {
      expect(res.expired).toBe(true);
    }
  });

  it('formats direct JSON and URL-encoded JSON', () => {
    const direct = inspectCookieValue('{"theme":"dark","v":2}');
    expect(direct?.kind).toBe('json');
    if (direct?.kind === 'json') {
      expect(direct.wasUrlEncoded).toBe(false);
      expect(direct.pretty).toContain('"theme": "dark"');
    }

    const encoded = inspectCookieValue(encodeURIComponent('{"lang":"zh-CN"}'));
    expect(encoded?.kind).toBe('json');
    if (encoded?.kind === 'json') {
      expect(encoded.wasUrlEncoded).toBe(true);
      expect(encoded.pretty).toContain('"lang": "zh-CN"');
    }
  });

  it('decodes Base64 JSON and plain URL-encoded text', () => {
    const b64 = Buffer.from('{"user":"alice"}', 'utf8').toString('base64');
    const b64Res = inspectCookieValue(b64);
    expect(b64Res?.kind).toBe('base64');
    if (b64Res?.kind === 'base64') {
      expect(b64Res.isJson).toBe(true);
      expect(b64Res.decoded).toContain('"alice"');
    }

    const urlRes = inspectCookieValue('hello%20world%2Ftest');
    expect(urlRes).toEqual({ kind: 'urlencoded', decoded: 'hello world/test' });
  });

  it('returns null for plain opaque tokens', () => {
    expect(inspectCookieValue('plain_session_value_12345')).toBeNull();
    expect(inspectCookieValue('')).toBeNull();
  });
});

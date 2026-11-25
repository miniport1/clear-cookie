export type InspectedValue =
  | {
      kind: 'jwt';
      header: string;
      payload: string;
      expired?: boolean;
      expiresAt?: string;
      issuedAt?: string;
    }
  | {
      kind: 'json';
      pretty: string;
      wasUrlEncoded: boolean;
    }
  | {
      kind: 'base64';
      decoded: string;
      isJson: boolean;
    }
  | {
      kind: 'urlencoded';
      decoded: string;
    };

function decodeBase64UrlToUtf8(input: string): string | null {
  try {
    let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4;
    if (pad === 1) return null;
    if (pad > 0) base64 += '='.repeat(4 - pad);

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function isMostlyPrintable(text: string): boolean {
  if (!text) return false;
  let printable = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) {
      printable++;
    }
  }
  return printable / text.length >= 0.92;
}

function formatEpochSeconds(sec: number): string {
  const date = new Date(sec * 1000);
  if (Number.isNaN(date.getTime())) return String(sec);
  return date.toLocaleString('zh-CN', { hour12: false });
}

function tryParseJsonObjectOrArray(str: string): unknown | null {
  const trimmed = str.trim();
  if (
    !(trimmed.startsWith('{') && trimmed.endsWith('}')) &&
    !(trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function tryInspectJwt(raw: string): InspectedValue | null {
  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const [hPart, pPart, sPart] = parts;
  if (!hPart || !pPart || !sPart) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(hPart) || !/^[A-Za-z0-9_-]+$/.test(pPart)) return null;

  const hText = decodeBase64UrlToUtf8(hPart);
  const pText = decodeBase64UrlToUtf8(pPart);
  if (!hText || !pText) return null;

  const headerObj = tryParseJsonObjectOrArray(hText);
  const payloadObj = tryParseJsonObjectOrArray(pText);
  if (!headerObj || typeof headerObj !== 'object' || Array.isArray(headerObj)) return null;
  if (!payloadObj || typeof payloadObj !== 'object' || Array.isArray(payloadObj)) return null;

  const payload = payloadObj as Record<string, unknown>;
  const result: InspectedValue = {
    kind: 'jwt',
    header: JSON.stringify(headerObj, null, 2),
    payload: JSON.stringify(payloadObj, null, 2),
  };

  if (typeof payload.exp === 'number' && Number.isFinite(payload.exp)) {
    result.expired = payload.exp * 1000 < Date.now();
    result.expiresAt = formatEpochSeconds(payload.exp);
  }
  if (typeof payload.iat === 'number' && Number.isFinite(payload.iat)) {
    result.issuedAt = formatEpochSeconds(payload.iat);
  }

  return result;
}

export function inspectCookieValue(raw: string): InspectedValue | null {
  const value = raw.trim();
  if (!value) return null;

  // 1. JWT
  const jwt = tryInspectJwt(value);
  if (jwt) return jwt;

  // 2. Direct JSON
  const directJson = tryParseJsonObjectOrArray(value);
  if (directJson !== null) {
    return {
      kind: 'json',
      pretty: JSON.stringify(directJson, null, 2),
      wasUrlEncoded: false,
    };
  }

  // 3. URL-encoded (possibly containing JSON or JWT)
  if (/%[0-9A-Fa-f]{2}/.test(value)) {
    try {
      const decoded = decodeURIComponent(value);
      if (decoded !== value) {
        const innerJwt = tryInspectJwt(decoded);
        if (innerJwt) return innerJwt;

        const innerJson = tryParseJsonObjectOrArray(decoded);
        if (innerJson !== null) {
          return {
            kind: 'json',
            pretty: JSON.stringify(innerJson, null, 2),
            wasUrlEncoded: true,
          };
        }
        return { kind: 'urlencoded', decoded };
      }
    } catch {
      // Malformed percent encoding; fall through
    }
  }

  // 4. Base64 / Base64URL (require length >= 8 to avoid false positives on short tokens)
  if (value.length >= 8 && /^[A-Za-z0-9+/_-]+=*$/.test(value)) {
    const decoded = decodeBase64UrlToUtf8(value);
    if (decoded && decoded !== value && isMostlyPrintable(decoded)) {
      const innerJson = tryParseJsonObjectOrArray(decoded);
      if (innerJson !== null) {
        return {
          kind: 'base64',
          decoded: JSON.stringify(innerJson, null, 2),
          isJson: true,
        };
      }
      // Only surface non-JSON base64 if it looks meaningfully readable (spaces/punctuation/words)
      if (/[\s:=/{}"',;-]/.test(decoded)) {
        return {
          kind: 'base64',
          decoded,
          isJson: false,
        };
      }
    }
  }

  return null;
}

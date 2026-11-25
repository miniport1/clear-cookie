import { ext } from './browser-api';
import type { CookieDraft, CookieItem, TabContext } from './types';

export function parseTabContext(tab: {
  id?: number;
  url?: string;
  cookieStoreId?: string;
}): TabContext {
  const url = tab.url ?? '';
  try {
    const parsed = new URL(url);
    const isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    return {
      tabId: tab.id ?? -1,
      url,
      origin: isHttp ? parsed.origin : '',
      hostname: isHttp ? parsed.hostname : '',
      protocol: parsed.protocol,
      cookieStoreId: tab.cookieStoreId,
      isSupported: isHttp && Boolean(parsed.hostname),
    };
  } catch {
    return {
      tabId: tab.id ?? -1,
      url,
      origin: '',
      hostname: '',
      protocol: '',
      cookieStoreId: tab.cookieStoreId,
      isSupported: false,
    };
  }
}

export function buildCookieUrl(
  cookie: { domain: string; path: string; secure: boolean },
  fallbackProtocol = 'https:',
): string {
  const host = cookie.domain.replace(/^\.+/, '');
  const protocol = cookie.secure
    ? 'https:'
    : fallbackProtocol === 'http:'
      ? 'http:'
      : 'https:';
  const path = cookie.path.startsWith('/') ? cookie.path : `/${cookie.path}`;
  return `${protocol}//${host}${path}`;
}

export function cookieIdentityKey(
  cookie: Pick<CookieItem, 'name' | 'domain' | 'path' | 'storeId' | 'partitionKey'>,
): string {
  const topLevel = cookie.partitionKey?.topLevelSite ?? '';
  return [cookie.name, cookie.domain, cookie.path, cookie.storeId ?? '', topLevel].join('\u0000');
}

export function validateCookieDraft(draft: CookieDraft): string | null {
  if (!draft.name.trim()) {
    return 'Cookie 名称不能为空';
  }
  if (/[\s;=,]/.test(draft.name)) {
    return 'Cookie 名称不能包含空格、分号、等号或逗号';
  }
  if (!draft.domain.trim()) {
    return 'Domain 不能为空';
  }
  if (draft.name.startsWith('__Secure-') && !draft.secure) {
    return '__Secure- 前缀的 Cookie 必须勾选 Secure';
  }
  if (draft.name.startsWith('__Host-')) {
    if (!draft.secure || draft.path !== '/' || !draft.hostOnly) {
      return '__Host- 前缀的 Cookie 必须勾选 Secure、HostOnly，且 Path 为 /';
    }
  }
  if (draft.sameSite === 'no_restriction' && !draft.secure) {
    return 'SameSite 设为 None (no_restriction) 时必须勾选 Secure';
  }
  if (!draft.session && (draft.expirationDate === undefined || !Number.isFinite(draft.expirationDate))) {
    return '非 Session Cookie 需要填写有效的过期时间';
  }
  return null;
}

export function sortCookies(cookies: CookieItem[]): CookieItem[] {
  return [...cookies].sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
    const byDomain = a.domain.localeCompare(b.domain);
    if (byDomain !== 0) return byDomain;
    return a.path.localeCompare(b.path);
  });
}

export async function listCookiesForTab(ctx: TabContext): Promise<CookieItem[]> {
  if (!ctx.isSupported) return [];

  const baseDetails: {
    url: string;
    storeId?: string;
    partitionKey?: Record<string, never>;
  } = {
    url: ctx.url,
  };
  if (ctx.cookieStoreId) {
    baseDetails.storeId = ctx.cookieStoreId;
  }

  // Request both unpartitioned and CHIPS partitioned cookies when supported
  try {
    const list = await ext.getAllCookies({ ...baseDetails, partitionKey: {} });
    return sortCookies(list);
  } catch {
    const list = await ext.getAllCookies(baseDetails);
    return sortCookies(list);
  }
}

export async function saveCookie(
  draft: CookieDraft,
  ctx: TabContext,
  previous?: CookieItem,
): Promise<CookieItem> {
  const err = validateCookieDraft(draft);
  if (err) {
    throw new Error(err);
  }

  const normalizedPath = draft.path.startsWith('/') ? draft.path : `/${draft.path}`;
  const cleanDomain = draft.domain.trim();
  const url = buildCookieUrl(
    { domain: cleanDomain, path: normalizedPath, secure: draft.secure },
    ctx.protocol,
  );

  const details: Parameters<typeof ext.setCookie>[0] = {
    url,
    name: draft.name.trim(),
    value: draft.value,
    path: normalizedPath,
    secure: draft.secure,
    httpOnly: draft.httpOnly,
    sameSite: draft.sameSite,
  };

  if (!draft.hostOnly) {
    details.domain = cleanDomain;
  }
  if (!draft.session && draft.expirationDate !== undefined) {
    details.expirationDate = draft.expirationDate;
  }
  const storeId = draft.storeId ?? ctx.cookieStoreId;
  if (storeId) {
    details.storeId = storeId;
  }
  if (draft.partitionKey && draft.partitionKey.topLevelSite) {
    details.partitionKey = draft.partitionKey;
  }
  if (draft.firstPartyDomain) {
    details.firstPartyDomain = draft.firstPartyDomain;
  }

  const saved = await ext.setCookie(details);
  if (!saved) {
    throw new Error('浏览器拒绝写入此 Cookie，请检查 Domain、Secure 或前缀规则');
  }

  // Remove previous cookie if identity (name/domain/path/hostOnly) changed
  if (previous) {
    const prevKey = cookieIdentityKey(previous);
    const nextKey = cookieIdentityKey(saved);
    if (prevKey !== nextKey || previous.hostOnly !== saved.hostOnly) {
      try {
        await deleteCookie(previous, ctx.protocol);
      } catch {
        // Ignore cleanup failure if already overwritten
      }
    }
  }

  return saved;
}

export async function deleteCookie(
  cookie: CookieItem,
  fallbackProtocol = 'https:',
): Promise<void> {
  const url = buildCookieUrl(cookie, fallbackProtocol);
  const details: Parameters<typeof ext.removeCookie>[0] = {
    url,
    name: cookie.name,
  };
  if (cookie.storeId) {
    details.storeId = cookie.storeId;
  }
  if (cookie.partitionKey && cookie.partitionKey.topLevelSite) {
    details.partitionKey = cookie.partitionKey;
  }
  if (cookie.firstPartyDomain) {
    details.firstPartyDomain = cookie.firstPartyDomain;
  }
  await ext.removeCookie(details);
}

export async function clearCookiesForTab(ctx: TabContext): Promise<number> {
  const list = await listCookiesForTab(ctx);
  let removed = 0;
  for (const c of list) {
    try {
      await deleteCookie(c, ctx.protocol);
      removed++;
    } catch {
      // Continue clearing remaining cookies
    }
  }
  return removed;
}

export async function importCookiesForTab(
  drafts: CookieDraft[],
  ctx: TabContext,
): Promise<{ imported: number; failed: Array<{ name: string; reason: string }> }> {
  let imported = 0;
  const failed: Array<{ name: string; reason: string }> = [];

  for (const draft of drafts) {
    try {
      await saveCookie(draft, ctx);
      imported++;
    } catch (err) {
      failed.push({
        name: draft.name,
        reason: err instanceof Error ? err.message : '写入失败',
      });
    }
  }

  return { imported, failed };
}

import type { CookieItem, CookiePartitionKey, SameSiteStatus } from './types';

// Minimal WebExtension type declarations (zero external runtime dependency)
interface RawTab {
  id?: number;
  url?: string;
  cookieStoreId?: string;
  active?: boolean;
}

interface RawPermissions {
  origins?: string[];
  permissions?: string[];
}

interface RawCookieSetDetails {
  url: string;
  name?: string;
  value?: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: SameSiteStatus;
  expirationDate?: number;
  storeId?: string;
  partitionKey?: CookiePartitionKey;
  firstPartyDomain?: string;
}

interface RawCookieGetAllDetails {
  url?: string;
  domain?: string;
  name?: string;
  path?: string;
  storeId?: string;
  partitionKey?: CookiePartitionKey;
  firstPartyDomain?: string;
}

interface RawCookieRemoveDetails {
  url: string;
  name: string;
  storeId?: string;
  partitionKey?: CookiePartitionKey;
  firstPartyDomain?: string;
}

interface WebExtensionRuntime {
  lastError?: { message?: string };
  getManifest: () => Record<string, unknown>;
  openOptionsPage: () => Promise<void> | void;
}

interface WebExtensionEvent<T extends (...args: never[]) => void> {
  addListener: (cb: T) => void;
  removeListener: (cb: T) => void;
}

interface WebExtensionNamespace {
  runtime: WebExtensionRuntime;
  tabs: {
    query: (queryInfo: Record<string, unknown>) => Promise<RawTab[]>;
    get: (tabId: number) => Promise<RawTab>;
    onActivated: WebExtensionEvent<(info: { tabId: number; windowId: number }) => void>;
    onUpdated: WebExtensionEvent<
      (tabId: number, changeInfo: { status?: string; url?: string }, tab: RawTab) => void
    >;
  };
  cookies: {
    getAll: (details: RawCookieGetAllDetails) => Promise<CookieItem[]>;
    set: (details: RawCookieSetDetails) => Promise<CookieItem | null>;
    remove: (details: RawCookieRemoveDetails) => Promise<unknown>;
    onChanged?: WebExtensionEvent<(changeInfo: { removed: boolean; cookie: CookieItem }) => void>;
  };
  permissions: {
    contains: (perms: RawPermissions) => Promise<boolean>;
    request: (perms: RawPermissions) => Promise<boolean>;
    remove: (perms: RawPermissions) => Promise<boolean>;
    getAll: () => Promise<RawPermissions>;
  };
  storage: {
    local: {
      get: (keys?: string | string[] | Record<string, unknown>) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
    };
  };
  sidePanel?: {
    setPanelBehavior?: (options: { openPanelOnActionClick: boolean }) => Promise<void>;
    open?: (options: { windowId?: number; tabId?: number }) => Promise<void>;
  };
  devtools?: {
    inspectedWindow: {
      tabId: number;
    };
    panels: {
      create: (
        title: string,
        iconPath: string,
        pagePath: string,
        callback?: (panel: unknown) => void,
      ) => void;
    };
  };
}

function getRawApi(): WebExtensionNamespace {
  const g = globalThis as unknown as {
    browser?: WebExtensionNamespace;
    chrome?: WebExtensionNamespace;
  };
  if (g.browser) return g.browser;
  if (g.chrome) return g.chrome;
  throw new Error('WebExtension API 不可用');
}

export const ext = {
  get raw(): WebExtensionNamespace {
    return getRawApi();
  },

  isFirefox(): boolean {
    const g = globalThis as unknown as { browser?: unknown };
    return Boolean(g.browser) && typeof navigator !== 'undefined' && /Firefox/i.test(navigator.userAgent);
  },

  getManifest(): Record<string, unknown> {
    return getRawApi().runtime.getManifest();
  },

  async openOptionsPage(): Promise<void> {
    await getRawApi().runtime.openOptionsPage();
  },

  async getActiveTab(): Promise<RawTab | undefined> {
    const tabs = await getRawApi().tabs.query({ active: true, currentWindow: true });
    return tabs[0];
  },

  async getTab(tabId: number): Promise<RawTab> {
    return getRawApi().tabs.get(tabId);
  },

  async getAllCookies(details: RawCookieGetAllDetails): Promise<CookieItem[]> {
    return getRawApi().cookies.getAll(details);
  },

  async setCookie(details: RawCookieSetDetails): Promise<CookieItem | null> {
    return getRawApi().cookies.set(details);
  },

  async removeCookie(details: RawCookieRemoveDetails): Promise<void> {
    await getRawApi().cookies.remove(details);
  },

  async hasPermissions(perms: RawPermissions): Promise<boolean> {
    return getRawApi().permissions.contains(perms);
  },

  async requestPermissions(perms: RawPermissions): Promise<boolean> {
    return getRawApi().permissions.request(perms);
  },

  async removePermissions(perms: RawPermissions): Promise<boolean> {
    return getRawApi().permissions.remove(perms);
  },

  async getAllPermissions(): Promise<RawPermissions> {
    return getRawApi().permissions.getAll();
  },

  async storageGet<T = Record<string, unknown>>(
    keys?: string | string[] | Record<string, unknown>,
  ): Promise<T> {
    const res = await getRawApi().storage.local.get(keys);
    return res as T;
  },

  async storageSet(items: Record<string, unknown>): Promise<void> {
    await getRawApi().storage.local.set(items);
  },
};

export type SameSiteStatus = 'unspecified' | 'no_restriction' | 'lax' | 'strict';

export interface CookiePartitionKey {
  topLevelSite?: string;
  hasCrossSiteAncestor?: boolean;
}

export interface CookieItem {
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: SameSiteStatus;
  session: boolean;
  expirationDate?: number;
  storeId?: string;
  partitionKey?: CookiePartitionKey;
  firstPartyDomain?: string;
}

export interface CookieDraft {
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: SameSiteStatus;
  session: boolean;
  expirationDate?: number;
  storeId?: string;
  partitionKey?: CookiePartitionKey;
  firstPartyDomain?: string;
}

export type ExportFormat = 'json' | 'header' | 'netscape';
export type ThemeMode = 'system' | 'light' | 'dark';
export type AppSurface = 'popup' | 'sidepanel' | 'devtools';

export interface ExtensionSettings {
  theme: ThemeMode;
  defaultExportFormat: ExportFormat;
  maskValuesByDefault: boolean;
  showAdvancedByDefault: boolean;
  fontSize: number;
}

export interface CookieProfile {
  id: string;
  name: string;
  origin: string;
  savedAt: number;
  cookies: CookieItem[];
}

export interface TabContext {
  tabId: number;
  url: string;
  origin: string;
  hostname: string;
  protocol: string;
  cookieStoreId?: string;
  isSupported: boolean;
}

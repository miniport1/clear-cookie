import { ext } from './browser-api';
import type { CookieItem, CookieProfile, ExtensionSettings } from './types';

const SETTINGS_KEY = 'cc_settings';
const PROFILES_KEY = 'cc_profiles';

export const MIN_FONT_SIZE = 12;
export const MAX_FONT_SIZE = 18;
export const DEFAULT_FONT_SIZE = 14;

export const DEFAULT_SETTINGS: ExtensionSettings = {
  theme: 'system',
  defaultExportFormat: 'json',
  maskValuesByDefault: false,
  showAdvancedByDefault: false,
  fontSize: DEFAULT_FONT_SIZE,
};

export function clampFontSize(raw: unknown): number {
  const num = typeof raw === 'number' ? Math.round(raw) : Number(raw);
  if (!Number.isFinite(num)) return DEFAULT_FONT_SIZE;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, num));
}

function parseSettingsObject(stored: unknown): ExtensionSettings {
  if (!stored || typeof stored !== 'object') {
    return { ...DEFAULT_SETTINGS };
  }
  const obj = stored as Partial<ExtensionSettings>;
  return {
    theme: obj.theme === 'light' || obj.theme === 'dark' ? obj.theme : 'system',
    defaultExportFormat:
      obj.defaultExportFormat === 'header' || obj.defaultExportFormat === 'netscape'
        ? obj.defaultExportFormat
        : 'json',
    maskValuesByDefault: Boolean(obj.maskValuesByDefault),
    showAdvancedByDefault: Boolean(obj.showAdvancedByDefault),
    fontSize: clampFontSize(obj.fontSize),
  };
}

export async function loadSettings(): Promise<ExtensionSettings> {
  const data = await ext.storageGet<Record<string, unknown>>(SETTINGS_KEY);
  return parseSettingsObject(data[SETTINGS_KEY]);
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await ext.storageSet({
    [SETTINGS_KEY]: {
      ...settings,
      fontSize: clampFontSize(settings.fontSize),
    },
  });
}

export function onSettingsChanged(callback: (next: ExtensionSettings) => void): void {
  ext.raw.storage.onChanged?.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const entry = changes[SETTINGS_KEY];
    if (entry && entry.newValue !== undefined) {
      callback(parseSettingsObject(entry.newValue));
    }
  });
}

export async function loadProfilesForOrigin(origin: string): Promise<CookieProfile[]> {
  const all = await loadAllProfiles();
  return all.filter((p) => p.origin === origin).sort((a, b) => b.savedAt - a.savedAt);
}

export async function loadAllProfiles(): Promise<CookieProfile[]> {
  const data = await ext.storageGet<Record<string, unknown>>(PROFILES_KEY);
  const stored = data[PROFILES_KEY];
  if (!Array.isArray(stored)) return [];
  return stored as CookieProfile[];
}

export async function saveProfile(
  origin: string,
  name: string,
  cookies: CookieItem[],
): Promise<CookieProfile> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error('快照名称不能为空');
  }
  const all = await loadAllProfiles();
  const profile: CookieProfile = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: trimmedName,
    origin,
    savedAt: Date.now(),
    cookies: cookies.map((c) => ({ ...c })),
  };
  all.unshift(profile);
  await ext.storageSet({ [PROFILES_KEY]: all });
  return profile;
}

export async function deleteProfile(id: string): Promise<void> {
  const all = await loadAllProfiles();
  const next = all.filter((p) => p.id !== id);
  await ext.storageSet({ [PROFILES_KEY]: next });
}

import { ext } from './browser-api';

export function originPatternFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return `${parsed.origin}/*`;
  } catch {
    return null;
  }
}

export async function hasPermissionForUrl(url: string): Promise<boolean> {
  const pattern = originPatternFromUrl(url);
  if (!pattern) return false;
  try {
    return await ext.hasPermissions({ origins: [pattern] });
  } catch {
    return false;
  }
}

export async function requestPermissionForOrigin(url: string): Promise<boolean> {
  const pattern = originPatternFromUrl(url);
  if (!pattern) return false;
  return ext.requestPermissions({ origins: [pattern] });
}

export async function requestAllSitesPermission(): Promise<boolean> {
  return ext.requestPermissions({ origins: ['<all_urls>'] });
}

export async function listGrantedOrigins(): Promise<string[]> {
  const perms = await ext.getAllPermissions();
  return [...(perms.origins ?? [])].sort();
}

export async function revokeOriginPermission(originPattern: string): Promise<boolean> {
  return ext.removePermissions({ origins: [originPattern] });
}

import { clampFontSize } from './storage';
import type { ThemeMode } from './types';

let mediaQuery: MediaQueryList | null = null;
let currentMode: ThemeMode = 'system';

function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(mode: ThemeMode): void {
  currentMode = mode;
  document.documentElement.dataset.theme = resolveTheme(mode);

  if (!mediaQuery) {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', () => {
      if (currentMode === 'system') {
        document.documentElement.dataset.theme = resolveTheme('system');
      }
    });
  }
}

export function applyFontSize(size: number): void {
  document.documentElement.dataset.fontSize = String(clampFontSize(size));
}

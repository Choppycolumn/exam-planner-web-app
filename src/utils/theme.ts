export type ThemeMode = 'light' | 'dark';

const themeStorageKey = 'examPlanner.theme';

export function resolveInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(themeStorageKey);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(mode: ThemeMode) {
  document.documentElement.dataset.theme = mode;
  window.localStorage.setItem(themeStorageKey, mode);
}

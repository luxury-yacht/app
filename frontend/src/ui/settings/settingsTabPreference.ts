/**
 * frontend/src/ui/settings/settingsTabPreference.ts
 *
 * Persists the last-active tab in the Settings modal across opens.
 * Stored in localStorage rather than backend AppSettings — this is purely
 * a UI affordance and does not need to sync across devices.
 */

export type SettingsTabId = 'appearance' | 'kubeconfigs' | 'display' | 'object-panel' | 'advanced';

const STORAGE_KEY = 'app-settings-last-tab';
const VALID_TABS: readonly SettingsTabId[] = [
  'appearance',
  'kubeconfigs',
  'display',
  'object-panel',
  'advanced',
];

export const DEFAULT_SETTINGS_TAB: SettingsTabId = 'appearance';

export function getLastSettingsTab(): SettingsTabId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (VALID_TABS as readonly string[]).includes(stored)) {
      return stored as SettingsTabId;
    }
  } catch {
    // localStorage unavailable; fall through to default.
  }
  return DEFAULT_SETTINGS_TAB;
}

export function setLastSettingsTab(tab: SettingsTabId): void {
  try {
    localStorage.setItem(STORAGE_KEY, tab);
  } catch {
    // ignore
  }
}

/**
 * frontend/src/components/content/Settings.tsx
 *
 * UI component for Settings.
 * Handles rendering and interactions for the shared components.
 */

import { useState, useEffect } from 'react';
import { GetThemeInfo, GetAppSettings, SetUseShortResourceNames } from '@wailsjs/go/backend/App';
import { types } from '@wailsjs/go/models';
import { errorHandler } from '@utils/errorHandler';
import { useAutoRefresh, useBackgroundRefresh } from '@/core/refresh';
import { changeTheme, initSystemThemeListener } from '@/utils/themes';
import { eventBus } from '@/core/events';
import './Settings.css';
import { clearAllGridTableState } from '@shared/components/tables/persistence/gridTablePersistenceReset';
import {
  getGridTablePersistenceMode,
  setGridTablePersistenceMode,
  type GridTablePersistenceMode,
} from '@shared/components/tables/persistence/gridTablePersistenceSettings';

interface SettingsProps {
  onClose?: () => void;
}

function Settings({ onClose }: SettingsProps) {
  const [themeInfo, setThemeInfo] = useState<types.ThemeInfo | null>(null);
  const { enabled: refreshEnabled, setAutoRefresh } = useAutoRefresh();
  const { enabled: backgroundRefreshEnabled, setBackgroundRefresh } = useBackgroundRefresh();
  const [useShortResourceNames, setUseShortResourceNames] = useState<boolean>(false);
  const [persistenceMode, setPersistenceMode] = useState<GridTablePersistenceMode>(() =>
    getGridTablePersistenceMode()
  );

  useEffect(() => {
    loadThemeInfo();
    loadAppSettings();
    setPersistenceMode(getGridTablePersistenceMode());

    // Initialize system theme listener using shared utility
    const themeCleanup = initSystemThemeListener();
    return themeCleanup;
  }, []);

  const loadThemeInfo = async () => {
    try {
      const info = await GetThemeInfo();
      setThemeInfo(info);
    } catch (error) {
      errorHandler.handle(error, { action: 'loadThemeInfo' });
    }
  };

  const loadAppSettings = async () => {
    try {
      const settings = await GetAppSettings();
      if (settings) {
        setUseShortResourceNames(settings.useShortResourceNames || false);
        // Store in localStorage for immediate access by other components
        localStorage.setItem(
          'useShortResourceNames',
          String(settings.useShortResourceNames || false)
        );
      }
    } catch (error) {
      errorHandler.handle(error, { action: 'loadAppSettings' });
    }
  };

  const handleThemeChange = async (theme: string) => {
    try {
      await changeTheme(theme);
      await loadThemeInfo(); // Refresh theme info to show updated backend state
    } catch (error) {
      errorHandler.handle(error, { action: 'setTheme', theme });
    }
  };

  const handleRefreshToggle = (enabled: boolean) => {
    setAutoRefresh(enabled);
  };

  const handleShortNamesToggle = async (useShort: boolean) => {
    try {
      await SetUseShortResourceNames(useShort);
      setUseShortResourceNames(useShort);
      // Store in localStorage for immediate access
      localStorage.setItem('useShortResourceNames', String(useShort));
      // Notify components to re-render
      eventBus.emit('settings:short-names', useShort);
    } catch (error) {
      errorHandler.handle(error, { action: 'setUseShortResourceNames', useShort });
      // Reload to show actual settings
      await loadAppSettings();
    }
  };

  const handlePersistenceModeToggle = (checked: boolean) => {
    const mode: GridTablePersistenceMode = checked ? 'namespaced' : 'shared';
    setPersistenceMode(mode);
    setGridTablePersistenceMode(mode);
  };

  const handleResetAllViews = () => {
    clearAllGridTableState();
  };

  return (
    <div className="settings-view">
      {onClose && (
        <button
          className="settings-close-button"
          onClick={onClose}
          title="Close Settings (Esc)"
          aria-label="Close Settings"
        >
          ✕
        </button>
      )}
      <div className="settings-section">
        <h3>Appearance</h3>
        <div className="theme-selector">
          <div className="theme-option">
            <input
              type="radio"
              id="theme-light"
              name="theme"
              value="light"
              checked={themeInfo?.userTheme === 'light'}
              onChange={(e) => handleThemeChange(e.target.value)}
            />
            <label htmlFor="theme-light" className="theme-label">
              <span className="theme-icon">☀️</span>
              <span className="theme-name">Light</span>
            </label>
          </div>
          <div className="theme-option">
            <input
              type="radio"
              id="theme-dark"
              name="theme"
              value="dark"
              checked={themeInfo?.userTheme === 'dark'}
              onChange={(e) => handleThemeChange(e.target.value)}
            />
            <label htmlFor="theme-dark" className="theme-label">
              <span className="theme-icon">🌙</span>
              <span className="theme-name">Dark</span>
            </label>
          </div>
          <div className="theme-option">
            <input
              type="radio"
              id="theme-system"
              name="theme"
              value="system"
              checked={themeInfo?.userTheme === 'system' || !themeInfo?.userTheme}
              onChange={(e) => handleThemeChange(e.target.value)}
            />
            <label htmlFor="theme-system" className="theme-label">
              <span className="theme-icon">💻</span>
              <span className="theme-name">System</span>
            </label>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>Auto-Refresh</h3>
        <div className="refresh-settings">
          <div className="setting-item">
            <label htmlFor="refresh-enabled">
              <input
                type="checkbox"
                id="refresh-enabled"
                checked={refreshEnabled}
                onChange={(e) => handleRefreshToggle(e.target.checked)}
              />
              Enable auto-refresh
            </label>
          </div>
          <div className="setting-item">
            <label htmlFor="refresh-background">
              <input
                type="checkbox"
                id="refresh-background"
                checked={backgroundRefreshEnabled}
                onChange={(e) => setBackgroundRefresh(e.target.checked)}
              />
              Refresh background clusters
            </label>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>Display</h3>
        <div className="display-settings">
          <div className="setting-item">
            <label htmlFor="short-resource-names">
              <input
                type="checkbox"
                id="short-resource-names"
                checked={useShortResourceNames}
                onChange={(e) => handleShortNamesToggle(e.target.checked)}
              />
              Use short resource names (e.g., "sts" for StatefulSets)
            </label>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>View Persistence</h3>
        <div className="setting-item">
          <label htmlFor="persist-namespaced">
            <input
              type="checkbox"
              id="persist-namespaced"
              checked={persistenceMode === 'namespaced'}
              onChange={(e) => handlePersistenceModeToggle(e.target.checked)}
            />
            Persist state per namespaced view
          </label>
        </div>
        <div className="setting-item">
          <button type="button" className="button generic" onClick={handleResetAllViews}>
            Reset All Views
          </button>
        </div>
      </div>
    </div>
  );
}

export default Settings;

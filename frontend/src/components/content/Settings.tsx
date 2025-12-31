/**
 * frontend/src/components/content/Settings.tsx
 *
 * UI component for Settings.
 * Handles rendering and interactions for the shared components.
 */

import { useState, useEffect } from 'react';
import { GetThemeInfo } from '@wailsjs/go/backend/App';
import { types } from '@wailsjs/go/models';
import { errorHandler } from '@utils/errorHandler';
import { useAutoRefresh, useBackgroundRefresh } from '@/core/refresh';
import { changeTheme, initSystemThemeListener } from '@/utils/themes';
import './Settings.css';
import { clearAllGridTableState } from '@shared/components/tables/persistence/gridTablePersistenceReset';
import {
  hydrateAppPreferences,
  setUseShortResourceNames as persistUseShortResourceNames,
} from '@/core/settings/appPreferences';
import {
  getGridTablePersistenceMode,
  setGridTablePersistenceMode,
  type GridTablePersistenceMode,
} from '@shared/components/tables/persistence/gridTablePersistenceSettings';
import ConfirmationModal from '@components/modals/ConfirmationModal';

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
  // Controls the confirmation modal for clearing all persisted app state.
  const [isClearStateConfirmOpen, setIsClearStateConfirmOpen] = useState(false);
  // Controls the confirmation modal for resetting view persistence.
  const [isResetViewsConfirmOpen, setIsResetViewsConfirmOpen] = useState(false);

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
      const preferences = await hydrateAppPreferences();
      setUseShortResourceNames(preferences.useShortResourceNames);
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
      await persistUseShortResourceNames(useShort);
      setUseShortResourceNames(useShort);
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

  const handleResetViews = async () => {
    setIsResetViewsConfirmOpen(false);
    await clearAllGridTableState();
  };

  // Clear persisted app state across backend files and browser storage, then reload.
  const handleClearAllState = async () => {
    setIsClearStateConfirmOpen(false);
    try {
      const clearAppState = (window as any)?.go?.backend?.App?.ClearAppState;
      if (typeof clearAppState !== 'function') {
        throw new Error('ClearAppState is not available');
      }
      await clearAppState();

      await clearAllGridTableState();
      try {
        localStorage.clear();
      } catch {
        /* ignore */
      }
      try {
        sessionStorage.clear();
      } catch {
        /* ignore */
      }

      window.location.reload();
    } catch (error) {
      errorHandler.handle(error, { action: 'clearAllState' });
    }
  };

  const handleClearAllStateRequest = () => {
    setIsClearStateConfirmOpen(true);
  };

  const handleResetViewsRequest = () => {
    setIsResetViewsConfirmOpen(true);
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
        <div className="settings-items">
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
        <div className="settings-items">
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
        <h3>App State</h3>
        <div className="settings-items">
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
          <div className="setting-item setting-actions">
            <button type="button" className="button generic" onClick={handleResetViewsRequest}>
              Reset Views
            </button>
            <button type="button" className="button generic" onClick={handleClearAllStateRequest}>
              Factory Reset
            </button>
          </div>
        </div>
      </div>
      <ConfirmationModal
        isOpen={isResetViewsConfirmOpen}
        title="Reset Views"
        message="This will clear your view settings (columns/sorting/filters). Are you sure?"
        confirmText="Confirm"
        confirmButtonClass="warning"
        onConfirm={handleResetViews}
        onCancel={() => setIsResetViewsConfirmOpen(false)}
      />
      <ConfirmationModal
        isOpen={isClearStateConfirmOpen}
        title="Factory Reset"
        message="This will clear all saved state and restart the app. Are you sure?"
        confirmText="Confirm"
        confirmButtonClass="danger"
        onConfirm={handleClearAllState}
        onCancel={() => setIsClearStateConfirmOpen(false)}
      />
    </div>
  );
}

export default Settings;

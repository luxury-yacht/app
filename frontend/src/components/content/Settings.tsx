/**
 * frontend/src/components/content/Settings.tsx
 *
 * UI component for Settings.
 * Handles rendering and interactions for the shared components.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  GetKubeconfigSearchPaths,
  GetThemeInfo,
  OpenKubeconfigSearchPathDialog,
  SetKubeconfigSearchPaths,
} from '@wailsjs/go/backend/App';
import { types } from '@wailsjs/go/models';
import { errorHandler } from '@utils/errorHandler';
import { useAutoRefresh, useBackgroundRefresh } from '@/core/refresh';
import { changeTheme, initSystemThemeListener } from '@/utils/themes';
import './Settings.css';
import { clearAllGridTableState } from '@shared/components/tables/persistence/gridTablePersistenceReset';
import {
  hydrateAppPreferences,
  setUseShortResourceNames as persistUseShortResourceNames,
  setPaletteTint as persistPaletteTint,
} from '@/core/settings/appPreferences';
import {
  applyTintedPalette,
  clearTintedPalette,
  savePaletteTintToLocalStorage,
  clearPaletteTintFromLocalStorage,
} from '@utils/paletteTint';
import {
  getGridTablePersistenceMode,
  setGridTablePersistenceMode,
  type GridTablePersistenceMode,
} from '@shared/components/tables/persistence/gridTablePersistenceSettings';
import ConfirmationModal from '@components/modals/ConfirmationModal';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';

interface SettingsProps {
  onClose?: () => void;
}

function Settings({ onClose }: SettingsProps) {
  const [themeInfo, setThemeInfo] = useState<types.ThemeInfo | null>(null);
  const { enabled: refreshEnabled, setAutoRefresh } = useAutoRefresh();
  const { enabled: backgroundRefreshEnabled, setBackgroundRefresh } = useBackgroundRefresh();
  const { loadKubeconfigs } = useKubeconfig();
  const [useShortResourceNames, setUseShortResourceNames] = useState<boolean>(false);
  const [persistenceMode, setPersistenceMode] = useState<GridTablePersistenceMode>(() =>
    getGridTablePersistenceMode()
  );
  // Track kubeconfig search paths for the settings panel.
  const [kubeconfigPaths, setKubeconfigPaths] = useState<string[]>([]);
  const [savedKubeconfigPaths, setSavedKubeconfigPaths] = useState<string[]>([]);
  const [kubeconfigPathsLoading, setKubeconfigPathsLoading] = useState(false);
  const [kubeconfigPathsSaving, setKubeconfigPathsSaving] = useState(false);
  const [kubeconfigPathsSelecting, setKubeconfigPathsSelecting] = useState(false);
  // Keep the default kubeconfig search path pinned in the list.
  const defaultKubeconfigPath = '~/.kube';
  // Palette tint state for hue/tone sliders
  const [paletteHue, setPaletteHue] = useState(0);
  const [paletteTone, setPaletteTone] = useState(0);
  // Debounce timer ref for palette tint persistence
  const palettePersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Controls the confirmation modal for clearing all persisted app state.
  const [isClearStateConfirmOpen, setIsClearStateConfirmOpen] = useState(false);
  // Controls the confirmation modal for resetting view persistence.
  const [isResetViewsConfirmOpen, setIsResetViewsConfirmOpen] = useState(false);
  const pathsDirty =
    kubeconfigPaths.length !== savedKubeconfigPaths.length ||
    kubeconfigPaths.some((path, index) => path !== savedKubeconfigPaths[index]);

  useEffect(() => {
    loadThemeInfo();
    loadAppSettings();
    loadKubeconfigPaths();
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
      setPaletteHue(preferences.paletteHue);
      setPaletteTone(preferences.paletteTone);
    } catch (error) {
      errorHandler.handle(error, { action: 'loadAppSettings' });
    }
  };

  const loadKubeconfigPaths = async () => {
    setKubeconfigPathsLoading(true);
    try {
      const paths = await GetKubeconfigSearchPaths();
      const normalized = paths || [];
      setKubeconfigPaths(normalized);
      setSavedKubeconfigPaths(normalized);
    } catch (error) {
      errorHandler.handle(error, { action: 'loadKubeconfigPaths' });
    } finally {
      setKubeconfigPathsLoading(false);
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

  // Debounced persistence for palette tint — avoids hammering the backend during fast drags.
  const debouncePalettePersist = useCallback((hue: number, tone: number) => {
    if (palettePersistTimer.current) {
      clearTimeout(palettePersistTimer.current);
    }
    palettePersistTimer.current = setTimeout(() => {
      persistPaletteTint(hue, tone);
      savePaletteTintToLocalStorage(hue, tone);
    }, 300);
  }, []);

  const handlePaletteHueChange = (value: number) => {
    setPaletteHue(value);
    applyTintedPalette(value, paletteTone);
    debouncePalettePersist(value, paletteTone);
  };

  const handlePaletteToneChange = (value: number) => {
    setPaletteTone(value);
    applyTintedPalette(paletteHue, value);
    debouncePalettePersist(paletteHue, value);
  };

  const handlePaletteReset = () => {
    setPaletteHue(0);
    setPaletteTone(0);
    clearTintedPalette();
    persistPaletteTint(0, 0);
    clearPaletteTintFromLocalStorage();
  };

  const handleAddKubeconfigPath = async () => {
    setKubeconfigPathsSelecting(true);
    try {
      const selected = await OpenKubeconfigSearchPathDialog();
      const trimmed = selected?.trim();
      if (!trimmed) {
        return;
      }
      setKubeconfigPaths((prev) => {
        if (prev.some((path) => path.trim() === trimmed)) {
          return prev;
        }
        return [...prev, trimmed];
      });
    } catch (error) {
      errorHandler.handle(error, { action: 'addKubeconfigPath' });
    } finally {
      setKubeconfigPathsSelecting(false);
    }
  };

  const handleRemoveKubeconfigPath = (index: number) => {
    setKubeconfigPaths((prev) =>
      prev.filter((path, currentIndex) => {
        if (currentIndex !== index) {
          return true;
        }
        // Prevent removing the default kubeconfig search path.
        return path.trim() === defaultKubeconfigPath;
      })
    );
  };

  const handleSaveKubeconfigPaths = async () => {
    setKubeconfigPathsSaving(true);
    try {
      await SetKubeconfigSearchPaths(kubeconfigPaths);
      await loadKubeconfigPaths();
      await loadKubeconfigs();
    } catch (error) {
      errorHandler.handle(error, { action: 'saveKubeconfigPaths' });
      await loadKubeconfigPaths();
    } finally {
      setKubeconfigPathsSaving(false);
    }
  };

  const handleResetViews = async () => {
    setIsResetViewsConfirmOpen(false);
    await clearAllGridTableState();
  };

  // Clear persisted app state across backend files and browser storage, then reload.
  const handleClearAllState = async () => {
    setIsClearStateConfirmOpen(false);
    try {
      // Clear palette tint before reload so UI reverts immediately.
      clearTintedPalette();

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

        <div className="palette-tint-controls">
          <div className="palette-slider-row">
            <label htmlFor="palette-hue">Hue</label>
            <input
              type="range"
              id="palette-hue"
              className="palette-slider palette-slider-hue"
              min={0}
              max={360}
              value={paletteHue}
              onChange={(e) => handlePaletteHueChange(Number(e.target.value))}
            />
            <span className="palette-slider-value">{paletteHue}°</span>
          </div>
          <div className="palette-slider-row">
            <label htmlFor="palette-tone">Tone</label>
            <input
              type="range"
              id="palette-tone"
              className="palette-slider palette-slider-tone"
              min={0}
              max={100}
              value={paletteTone}
              onChange={(e) => handlePaletteToneChange(Number(e.target.value))}
              style={{
                // Dynamic gradient from neutral gray to tinted at the current hue
                background: `linear-gradient(to right, hsl(0, 0%, 50%), hsl(${paletteHue}, 20%, 50%))`,
              }}
            />
            <span className="palette-slider-value">{paletteTone}%</span>
          </div>
          <button
            type="button"
            className="button generic"
            onClick={handlePaletteReset}
            disabled={paletteHue === 0 && paletteTone === 0}
          >
            Reset Palette
          </button>
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
        <h3>Kubeconfig Paths</h3>
        <div className="settings-items">
          <div className="setting-description">Add directories to scan for kubeconfig files.</div>
          {kubeconfigPathsLoading ? (
            <div className="setting-item kubeconfig-path-status">Loading kubeconfig paths...</div>
          ) : (
            <>
              {kubeconfigPaths.length === 0 && (
                <div className="setting-item kubeconfig-path-empty">No kubeconfig paths set.</div>
              )}
              {kubeconfigPaths.map((path, index) => {
                const isDefaultPath = path.trim() === defaultKubeconfigPath;
                return (
                  <div
                    className="setting-item kubeconfig-path-row"
                    key={`kubeconfig-path-${index}`}
                  >
                    {isDefaultPath ? (
                      <span className="kubeconfig-path-label">Default</span>
                    ) : (
                      <button
                        type="button"
                        className="kubeconfig-path-label kubeconfig-path-remove-button"
                        onClick={() => handleRemoveKubeconfigPath(index)}
                        disabled={kubeconfigPathsSaving}
                        aria-label={`Remove kubeconfig path ${index + 1}`}
                        title="Remove path"
                      >
                        ❌
                      </button>
                    )}
                    <span className="kubeconfig-path-value">{path}</span>
                  </div>
                );
              })}
            </>
          )}
          <div className="setting-item kubeconfig-path-actions">
            <button
              type="button"
              className="button generic"
              onClick={handleAddKubeconfigPath}
              disabled={kubeconfigPathsSaving || kubeconfigPathsLoading || kubeconfigPathsSelecting}
            >
              Add Path
            </button>
            <button
              type="button"
              className="button save"
              onClick={handleSaveKubeconfigPaths}
              disabled={kubeconfigPathsSaving || kubeconfigPathsLoading || !pathsDirty}
            >
              {kubeconfigPathsSaving ? 'Saving...' : 'Save Paths'}
            </button>
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

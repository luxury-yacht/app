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
  getPaletteTint,
  getAccentColor,
  setAccentColor as persistAccentColor,
} from '@/core/settings/appPreferences';
import { useTheme } from '@/core/contexts/ThemeContext';
import {
  applyTintedPalette,
  clearTintedPalette,
  savePaletteTintToLocalStorage,
} from '@utils/paletteTint';
import {
  applyAccentColor,
  applyAccentBg,
  saveAccentColorToLocalStorage,
  clearAccentColor,
} from '@utils/accentColor';
import {
  getGridTablePersistenceMode,
  setGridTablePersistenceMode,
  type GridTablePersistenceMode,
} from '@shared/components/tables/persistence/gridTablePersistenceSettings';
import ConfirmationModal from '@components/modals/ConfirmationModal';
import SegmentedButton from '@shared/components/SegmentedButton';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';

interface SettingsProps {
  onClose?: () => void;
}

function Settings({ onClose }: SettingsProps) {
  const [themeInfo, setThemeInfo] = useState<types.ThemeInfo | null>(null);
  const { enabled: refreshEnabled, setAutoRefresh } = useAutoRefresh();
  const { enabled: backgroundRefreshEnabled, setBackgroundRefresh } = useBackgroundRefresh();
  const { loadKubeconfigs } = useKubeconfig();
  const { resolvedTheme } = useTheme();
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
  // Palette tint state for hue/tone/brightness sliders
  const [paletteHue, setPaletteHue] = useState(0);
  const [paletteTone, setPaletteTone] = useState(0);
  const [paletteBrightness, setPaletteBrightness] = useState(0);
  // Debounce timer ref for palette tint persistence
  const palettePersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Accent color state and debounce timer
  const [accentColor, setAccentColorState] = useState('');
  const accentPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Inline hex editing state for accent color
  const [isEditingAccentHex, setIsEditingAccentHex] = useState(false);
  const [accentHexDraft, setAccentHexDraft] = useState('');
  const accentHexInputRef = useRef<HTMLInputElement>(null);
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

  // Reload slider values and accent color when the resolved theme changes.
  useEffect(() => {
    const tint = getPaletteTint(resolvedTheme);
    setPaletteHue(tint.hue);
    setPaletteTone(tint.tone);
    setPaletteBrightness(tint.brightness);
    setAccentColorState(getAccentColor(resolvedTheme));
  }, [resolvedTheme]);

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
      // Palette sliders are loaded by the resolvedTheme effect.
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
  const debouncePalettePersist = useCallback(
    (hue: number, tone: number, brightness: number) => {
      if (palettePersistTimer.current) {
        clearTimeout(palettePersistTimer.current);
      }
      palettePersistTimer.current = setTimeout(() => {
        persistPaletteTint(resolvedTheme, hue, tone, brightness);
        savePaletteTintToLocalStorage(resolvedTheme, hue, tone, brightness);
      }, 300);
    },
    [resolvedTheme]
  );

  const handlePaletteHueChange = (value: number) => {
    setPaletteHue(value);
    applyTintedPalette(value, paletteTone, paletteBrightness);
    debouncePalettePersist(value, paletteTone, paletteBrightness);
  };

  const handlePaletteToneChange = (value: number) => {
    setPaletteTone(value);
    applyTintedPalette(paletteHue, value, paletteBrightness);
    debouncePalettePersist(paletteHue, value, paletteBrightness);
  };

  const handlePaletteBrightnessChange = (value: number) => {
    setPaletteBrightness(value);
    applyTintedPalette(paletteHue, paletteTone, value);
    debouncePalettePersist(paletteHue, paletteTone, value);
  };

  // Per-value reset handlers for individual palette controls.
  const handleHueReset = () => {
    setPaletteHue(0);
    applyTintedPalette(0, paletteTone, paletteBrightness);
    debouncePalettePersist(0, paletteTone, paletteBrightness);
  };

  const handleToneReset = () => {
    setPaletteTone(0);
    applyTintedPalette(paletteHue, 0, paletteBrightness);
    debouncePalettePersist(paletteHue, 0, paletteBrightness);
  };

  const handleBrightnessReset = () => {
    setPaletteBrightness(0);
    applyTintedPalette(paletteHue, paletteTone, 0);
    debouncePalettePersist(paletteHue, paletteTone, 0);
  };

  // Debounced persistence for accent color — avoids hammering the backend during fast changes.
  const debounceAccentPersist = useCallback(
    (color: string) => {
      if (accentPersistTimer.current) {
        clearTimeout(accentPersistTimer.current);
      }
      accentPersistTimer.current = setTimeout(() => {
        persistAccentColor(resolvedTheme, color);
        saveAccentColorToLocalStorage(resolvedTheme, color);
      }, 300);
    },
    [resolvedTheme]
  );

  const handleAccentColorChange = (hex: string) => {
    setAccentColorState(hex);
    applyAccentColor(
      resolvedTheme === 'light' ? hex : getAccentColor('light'),
      resolvedTheme === 'dark' ? hex : getAccentColor('dark')
    );
    applyAccentBg(hex, resolvedTheme);
    debounceAccentPersist(hex);
  };

  // Reset accent color for the current resolved theme.
  const handleAccentReset = () => {
    setAccentColorState('');
    applyAccentColor(
      resolvedTheme === 'light' ? '' : getAccentColor('light'),
      resolvedTheme === 'dark' ? '' : getAccentColor('dark')
    );
    applyAccentBg('', resolvedTheme);
    persistAccentColor(resolvedTheme, '');
    saveAccentColorToLocalStorage(resolvedTheme, '');
  };

  // Inline hex editing handlers for accent color.
  const validHexRe = /^#[0-9a-fA-F]{6}$/;
  const defaultAccent = resolvedTheme === 'light' ? '#0d9488' : '#f59e0b';

  const handleAccentHexClick = () => {
    setAccentHexDraft(accentColor || defaultAccent);
    setIsEditingAccentHex(true);
    // Focus the input after it renders.
    requestAnimationFrame(() => accentHexInputRef.current?.select());
  };

  const handleAccentHexCommit = () => {
    let trimmed = accentHexDraft.trim().toLowerCase();
    if (!trimmed.startsWith('#')) trimmed = '#' + trimmed;
    // Expand shorthand #rgb → #rrggbb
    if (/^#[0-9a-f]{3}$/.test(trimmed)) {
      trimmed = '#' + trimmed[1] + trimmed[1] + trimmed[2] + trimmed[2] + trimmed[3] + trimmed[3];
    }
    if (validHexRe.test(trimmed)) {
      handleAccentColorChange(trimmed);
    }
    setIsEditingAccentHex(false);
  };

  const handleAccentHexCancel = () => {
    setIsEditingAccentHex(false);
  };

  // Reset all appearance customizations for the current resolved theme.
  const handleResetAll = () => {
    setPaletteHue(0);
    setPaletteTone(0);
    setPaletteBrightness(0);
    clearTintedPalette();
    persistPaletteTint(resolvedTheme, 0, 0, 0);
    savePaletteTintToLocalStorage(resolvedTheme, 0, 0, 0);
    handleAccentReset();
  };

  const isAnyCustomized =
    paletteHue !== 0 || paletteTone !== 0 || paletteBrightness !== 0 || !!accentColor;

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
      // Clear palette tint and accent color before reload so UI reverts immediately.
      clearTintedPalette();
      clearAccentColor();

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
        <div className="palette-tint-controls">
          {/* Theme selector — spans columns 2-4 */}
          <label>Theme</label>
          <SegmentedButton
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            value={themeInfo?.userTheme || 'system'}
            onChange={handleThemeChange}
          />
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
          <button
            type="button"
            className="palette-row-reset"
            onClick={handleHueReset}
            disabled={paletteHue === 0}
            title="Reset Hue"
          >
            ↺
          </button>

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
              background: `linear-gradient(to right, hsl(0, 0%, 50%), hsl(${paletteHue}, 20%, 50%))`,
            }}
          />
          <span className="palette-slider-value">{paletteTone}%</span>
          <button
            type="button"
            className="palette-row-reset"
            onClick={handleToneReset}
            disabled={paletteTone === 0}
            title="Reset Tone"
          >
            ↺
          </button>

          <label htmlFor="palette-brightness">Brightness</label>
          <input
            type="range"
            id="palette-brightness"
            className="palette-slider palette-slider-brightness"
            min={-50}
            max={50}
            value={paletteBrightness}
            onChange={(e) => handlePaletteBrightnessChange(Number(e.target.value))}
          />
          <span className="palette-slider-value">
            {paletteBrightness > 0 ? '+' : ''}
            {paletteBrightness}
          </span>
          <button
            type="button"
            className="palette-row-reset"
            onClick={handleBrightnessReset}
            disabled={paletteBrightness === 0}
            title="Reset Brightness"
          >
            ↺
          </button>

          <label>Accent</label>
          <input
            type="color"
            className="palette-accent-swatch"
            value={accentColor || (resolvedTheme === 'light' ? '#0d9488' : '#f59e0b')}
            onChange={(e) => handleAccentColorChange(e.target.value)}
          />
          {isEditingAccentHex ? (
            <input
              ref={accentHexInputRef}
              className="palette-slider-value palette-hex-input"
              value={accentHexDraft}
              onChange={(e) => setAccentHexDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleAccentHexCommit(); }
                else if (e.key === 'Escape') { e.preventDefault(); handleAccentHexCancel(); }
                else e.stopPropagation();
              }}
              onBlur={handleAccentHexCancel}
              maxLength={7}
              spellCheck={false}
            />
          ) : (
            <span
              className="palette-slider-value palette-hex-clickable"
              onClick={handleAccentHexClick}
              title="Click to edit hex value"
            >
              {accentColor || defaultAccent}
            </span>
          )}
          <button
            type="button"
            className="palette-row-reset"
            onClick={handleAccentReset}
            disabled={!accentColor}
            title="Reset Accent Color"
          >
            ↺
          </button>

          <button
            type="button"
            className="button generic palette-reset-all"
            onClick={handleResetAll}
            disabled={!isAnyCustomized}
          >
            Reset All
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

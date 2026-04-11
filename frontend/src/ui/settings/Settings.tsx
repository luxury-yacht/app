/**
 * frontend/src/components/content/Settings.tsx
 *
 * UI component for Settings.
 * Handles rendering and interactions for the shared components.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
import Tooltip from '@shared/components/Tooltip';
import './Settings.css';
import { clearAllGridTableState } from '@shared/components/tables/persistence/gridTablePersistenceReset';
import {
  hydrateAppPreferences,
  setUseShortResourceNames as persistUseShortResourceNames,
  setPaletteTint as persistPaletteTint,
  getPaletteTint,
  getAccentColor,
  setAccentColor as persistAccentColor,
  getLinkColor,
  setLinkColor as persistLinkColor,
  getThemes,
  saveTheme,
  deleteTheme as deleteThemeApi,
  reorderThemes,
  applyTheme as applyThemeApi,
} from '@/core/settings/appPreferences';
import { useTheme } from '@/core/contexts/ThemeContext';
import {
  applyTintedPalette,
  clearTintedPalette,
  savePaletteTintToLocalStorage,
  isPaletteActive,
} from '@utils/paletteTint';
import {
  applyAccentColor,
  applyAccentBg,
  saveAccentColorToLocalStorage,
  clearAccentColor,
} from '@utils/accentColor';
import { applyLinkColor, saveLinkColorToLocalStorage, clearLinkColor } from '@utils/linkColor';
import {
  getGridTablePersistenceMode,
  setGridTablePersistenceMode,
  type GridTablePersistenceMode,
} from '@shared/components/tables/persistence/gridTablePersistenceSettings';
import {
  getDefaultObjectPanelPosition,
  getLogApiTimestampFormat,
  getLogApiTimestampUseLocalTimeZone,
  setDefaultObjectPanelPosition,
  getObjectPanelLayoutDefaults,
  setObjectPanelLayoutDefaults,
  setLogApiTimestampFormat,
  setLogApiTimestampUseLocalTimeZone,
  getLogBufferMaxSize,
  setLogBufferMaxSize,
  getLogTargetGlobalLimit,
  getLogTargetPerScopeLimit,
  setLogTargetGlobalLimit,
  setLogTargetPerScopeLimit,
  LOG_BUFFER_MIN_SIZE,
  LOG_BUFFER_MAX_SIZE,
  LOG_BUFFER_DEFAULT_SIZE,
  LOG_TARGET_GLOBAL_DEFAULT,
  LOG_TARGET_GLOBAL_MAX,
  LOG_TARGET_GLOBAL_MIN,
  LOG_TARGET_PER_SCOPE_DEFAULT,
  LOG_TARGET_PER_SCOPE_MAX,
  LOG_TARGET_PER_SCOPE_MIN,
  type ObjectPanelPosition,
  type ObjectPanelLayoutDefaults,
} from '@core/settings/appPreferences';
import { useDockablePanelContext } from '@ui/dockable';
import { getContentBounds, PANEL_DEFAULTS } from '@ui/dockable/dockablePanelLayout';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import SegmentedButton from '@shared/components/SegmentedButton';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { getLogApiTimestampFormatValidationError } from '@/utils/logApiTimestampFormat';

interface SettingsProps {
  onClose?: () => void;
}

const objectPanelPositionOptions: DropdownOption[] = [
  { value: 'right', label: 'Right' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'floating', label: 'Floating' },
];

function Settings({ onClose }: SettingsProps) {
  const [themeInfo, setThemeInfo] = useState<types.ThemeInfo | null>(null);
  const { enabled: refreshEnabled, setAutoRefresh } = useAutoRefresh();
  const { enabled: backgroundRefreshEnabled, setBackgroundRefresh } = useBackgroundRefresh();
  const { loadKubeconfigs } = useKubeconfig();
  const { resolvedTheme } = useTheme();
  const { applyLayoutDefaultsAcrossClusters } = useDockablePanelContext();
  const [useShortResourceNames, setUseShortResourceNames] = useState<boolean>(false);
  const [persistenceMode, setPersistenceMode] = useState<GridTablePersistenceMode>(() =>
    getGridTablePersistenceMode()
  );
  const [objectPanelPosition, setObjectPanelPositionState] = useState<ObjectPanelPosition>(() =>
    getDefaultObjectPanelPosition()
  );
  const [panelLayout, setPanelLayout] = useState<ObjectPanelLayoutDefaults>(() =>
    getObjectPanelLayoutDefaults()
  );
  // Log buffer size local state. We mirror the raw string so the user
  // can temporarily type an out-of-range value while editing without the
  // input immediately snapping back — we only push to the preference
  // cache on blur/commit, where the normalizer clamps the final value.
  const [logBufferMaxSizeInput, setLogBufferMaxSizeInput] = useState<string>(() =>
    String(getLogBufferMaxSize())
  );
  const [logApiTimestampFormatInput, setLogApiTimestampFormatInput] = useState<string>(() =>
    getLogApiTimestampFormat()
  );
  const [logApiTimestampUseLocalTimeZone, setLogApiTimestampUseLocalTimeZoneState] =
    useState<boolean>(() => getLogApiTimestampUseLocalTimeZone());
  const [logApiTimestampFormatError, setLogApiTimestampFormatError] = useState<string | null>(null);
  const [logTargetPerScopeLimitInput, setLogTargetPerScopeLimitInput] = useState<string>(() =>
    String(getLogTargetPerScopeLimit())
  );
  const [logTargetGlobalLimitInput, setLogTargetGlobalLimitInput] = useState<string>(() =>
    String(getLogTargetGlobalLimit())
  );
  // Track kubeconfig search paths for the settings panel.
  const [kubeconfigPaths, setKubeconfigPaths] = useState<string[]>([]);
  const [savedKubeconfigPaths, setSavedKubeconfigPaths] = useState<string[]>([]);
  const [kubeconfigPathsLoading, setKubeconfigPathsLoading] = useState(false);
  const [kubeconfigPathsSaving, setKubeconfigPathsSaving] = useState(false);
  const [kubeconfigPathsSelecting, setKubeconfigPathsSelecting] = useState(false);
  // Keep the default kubeconfig search path pinned in the list.
  const defaultKubeconfigPath = '~/.kube';
  // Palette tint state for hue/saturation/brightness sliders
  const [paletteHue, setPaletteHue] = useState(0);
  const [paletteSaturation, setPaletteSaturation] = useState(0);
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
  // Link color state and debounce timer
  const [linkColor, setLinkColorState] = useState('');
  const linkPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Inline hex editing state for link color
  const [isEditingLinkHex, setIsEditingLinkHex] = useState(false);
  const [linkHexDraft, setLinkHexDraft] = useState('');
  const linkHexInputRef = useRef<HTMLInputElement>(null);
  // Inline editing state for palette slider values
  const [editingPaletteField, setEditingPaletteField] = useState<
    'hue' | 'saturation' | 'brightness' | null
  >(null);
  const [paletteDraft, setPaletteDraft] = useState('');
  const paletteInputRef = useRef<HTMLInputElement>(null);
  // Saved themes state
  const [themes, setThemes] = useState<types.Theme[]>([]);
  const [themesLoading, setThemesLoading] = useState(false);
  // Tracks which theme was last loaded via "Open" so Save is only enabled for it.
  const [activeThemeId, setActiveThemeId] = useState<string | null>(null);
  // 'new' = creating new theme via the form at the bottom
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null);
  const [themeDraft, setThemeDraft] = useState({ name: '', clusterPattern: '' });
  // Per-field inline editing for existing theme rows (name or pattern)
  const [editingThemeField, setEditingThemeField] = useState<{
    themeId: string;
    field: 'name' | 'clusterPattern';
  } | null>(null);
  const [themeFieldDraft, setThemeFieldDraft] = useState('');
  const themeFieldInputRef = useRef<HTMLInputElement>(null);
  // Drag reorder state (same pattern as ClusterTabs)
  const [draggingThemeId, setDraggingThemeId] = useState<string | null>(null);
  const [dropTargetThemeId, setDropTargetThemeId] = useState<string | null>(null);
  // Delete confirmation
  const [deleteConfirmThemeId, setDeleteConfirmThemeId] = useState<string | null>(null);
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
    setObjectPanelPositionState(getDefaultObjectPanelPosition());
    const loadedLayout = getObjectPanelLayoutDefaults();
    setPanelLayout(loadedLayout);
    setPanelLayoutInputs({
      dockedRightWidth: String(loadedLayout.dockedRightWidth),
      dockedBottomHeight: String(loadedLayout.dockedBottomHeight),
      floatingWidth: String(loadedLayout.floatingWidth),
      floatingHeight: String(loadedLayout.floatingHeight),
      floatingX: String(loadedLayout.floatingX),
      floatingY: String(loadedLayout.floatingY),
    });

    // Initialize system theme listener using shared utility
    const themeCleanup = initSystemThemeListener();
    return themeCleanup;
  }, []);

  // Load saved themes on mount.
  useEffect(() => {
    const loadThemes = async () => {
      setThemesLoading(true);
      try {
        const result = await getThemes();
        setThemes(result);
      } catch (error) {
        errorHandler.handle(error, { action: 'loadThemes' });
      } finally {
        setThemesLoading(false);
      }
    };
    loadThemes();
  }, []);

  // Reload slider values and accent color when the resolved theme changes.
  useEffect(() => {
    const tint = getPaletteTint(resolvedTheme);
    setPaletteHue(tint.hue);
    setPaletteSaturation(tint.saturation);
    setPaletteBrightness(tint.brightness);
    setAccentColorState(getAccentColor(resolvedTheme));
    setLinkColorState(getLinkColor(resolvedTheme));
  }, [resolvedTheme]);

  // Auto-focus the palette inline edit input when it appears.
  useEffect(() => {
    if (editingPaletteField && paletteInputRef.current) {
      paletteInputRef.current.focus();
      paletteInputRef.current.select();
    }
  }, [editingPaletteField]);

  // Auto-focus the theme field inline edit input when it appears.
  useEffect(() => {
    if (editingThemeField && themeFieldInputRef.current) {
      themeFieldInputRef.current.focus();
      themeFieldInputRef.current.select();
    }
  }, [editingThemeField]);

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
      const preferences = await hydrateAppPreferences({ force: true });
      setUseShortResourceNames(preferences.useShortResourceNames);
      // Refresh panel defaults from the freshly hydrated cache.
      setObjectPanelPositionState(getDefaultObjectPanelPosition());
      const freshLayout = getObjectPanelLayoutDefaults();
      setPanelLayout(freshLayout);
      setLogBufferMaxSizeInput(String(getLogBufferMaxSize()));
      setLogApiTimestampFormatInput(getLogApiTimestampFormat());
      setLogApiTimestampUseLocalTimeZoneState(getLogApiTimestampUseLocalTimeZone());
      setLogApiTimestampFormatError(null);
      setLogTargetPerScopeLimitInput(String(getLogTargetPerScopeLimit()));
      setLogTargetGlobalLimitInput(String(getLogTargetGlobalLimit()));
      setPanelLayoutInputs({
        dockedRightWidth: String(freshLayout.dockedRightWidth),
        dockedBottomHeight: String(freshLayout.dockedBottomHeight),
        floatingWidth: String(freshLayout.floatingWidth),
        floatingHeight: String(freshLayout.floatingHeight),
        floatingX: String(freshLayout.floatingX),
        floatingY: String(freshLayout.floatingY),
      });
      setLogBufferMaxSizeInput(String(getLogBufferMaxSize()));
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

  // Parse the raw text input, clamp to the allowed range, and push to
  // appPreferences. The preferences setter calls the normalizer again
  // so we can't get out-of-range values into the cache. On an
  // unparseable string, snap back to the last valid cached value.
  const commitLogBufferMaxSize = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      setLogBufferMaxSizeInput(String(getLogBufferMaxSize()));
      return;
    }
    const clamped = Math.max(LOG_BUFFER_MIN_SIZE, Math.min(LOG_BUFFER_MAX_SIZE, parsed));
    setLogBufferMaxSize(clamped);
    setLogBufferMaxSizeInput(String(clamped));
  };

  const commitLogTargetPerScopeLimit = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      setLogTargetPerScopeLimitInput(String(getLogTargetPerScopeLimit()));
      return;
    }
    const clamped = Math.max(LOG_TARGET_PER_SCOPE_MIN, Math.min(LOG_TARGET_PER_SCOPE_MAX, parsed));
    setLogTargetPerScopeLimit(clamped);
    setLogTargetPerScopeLimitInput(String(clamped));
  };

  const commitLogTargetGlobalLimit = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      setLogTargetGlobalLimitInput(String(getLogTargetGlobalLimit()));
      return;
    }
    const clamped = Math.max(LOG_TARGET_GLOBAL_MIN, Math.min(LOG_TARGET_GLOBAL_MAX, parsed));
    setLogTargetGlobalLimit(clamped);
    setLogTargetGlobalLimitInput(String(clamped));
  };

  const commitLogApiTimestampFormat = (raw: string) => {
    const validationError = getLogApiTimestampFormatValidationError(raw);
    if (validationError) {
      setLogApiTimestampFormatError(validationError);
      return;
    }
    const normalized = raw.trim();
    setLogApiTimestampFormat(normalized);
    setLogApiTimestampFormatInput(normalized);
    setLogApiTimestampFormatError(null);
  };

  const handleObjectPanelPositionChange = (position: ObjectPanelPosition) => {
    setObjectPanelPositionState(position);
    setDefaultObjectPanelPosition(position);
  };

  // Track raw input strings so users can freely backspace/clear without
  // the value snapping back to 0 on every keystroke.
  const [panelLayoutInputs, setPanelLayoutInputs] = useState<
    Record<keyof ObjectPanelLayoutDefaults, string>
  >(() => {
    const defaults = getObjectPanelLayoutDefaults();
    return {
      dockedRightWidth: String(defaults.dockedRightWidth),
      dockedBottomHeight: String(defaults.dockedBottomHeight),
      floatingWidth: String(defaults.floatingWidth),
      floatingHeight: String(defaults.floatingHeight),
      floatingX: String(defaults.floatingX),
      floatingY: String(defaults.floatingY),
    };
  });

  const fieldMinimums: Record<keyof ObjectPanelLayoutDefaults, number> = {
    dockedRightWidth: PANEL_DEFAULTS.RIGHT_MIN_WIDTH,
    dockedBottomHeight: PANEL_DEFAULTS.BOTTOM_MIN_HEIGHT,
    floatingWidth: PANEL_DEFAULTS.FLOATING_MIN_WIDTH,
    floatingHeight: PANEL_DEFAULTS.FLOATING_MIN_HEIGHT,
    floatingX: 0,
    floatingY: 0,
  };

  const handlePanelLayoutInput = (field: keyof ObjectPanelLayoutDefaults, raw: string) => {
    setPanelLayoutInputs((prev) => ({ ...prev, [field]: raw }));
    const parsed = parseInt(raw, 10);
    if (!Number.isNaN(parsed)) {
      const clamped = Math.max(fieldMinimums[field], Math.min(9999, parsed));
      const updated = { ...panelLayout, [field]: clamped };
      setPanelLayout(updated);
      setObjectPanelLayoutDefaults(updated);
      applyLayoutDefaultsAcrossClusters();
    }
  };

  const handlePanelLayoutBlur = (field: keyof ObjectPanelLayoutDefaults) => {
    // On blur, normalize the display to the current numeric value.
    setPanelLayoutInputs((prev) => ({ ...prev, [field]: String(panelLayout[field]) }));
  };

  // Warn when configured values exceed the current visible area.
  const panelLayoutWarning = useMemo(() => {
    const content = getContentBounds();
    const issues: string[] = [];
    const fields = new Set<keyof ObjectPanelLayoutDefaults>();
    if (panelLayout.dockedRightWidth > content.width) {
      issues.push('docked width exceeds content area');
      fields.add('dockedRightWidth');
    }
    if (panelLayout.dockedBottomHeight > content.height) {
      issues.push('docked height exceeds content area');
      fields.add('dockedBottomHeight');
    }
    if (panelLayout.floatingWidth > content.width) {
      issues.push('floating width exceeds content area');
      fields.add('floatingWidth');
    }
    if (panelLayout.floatingHeight > content.height) {
      issues.push('floating height exceeds content area');
      fields.add('floatingHeight');
    }
    if (panelLayout.floatingX + panelLayout.floatingWidth > content.width) {
      issues.push('floating panel extends beyond right edge');
      fields.add('floatingX');
      fields.add('floatingWidth');
    }
    if (panelLayout.floatingY + panelLayout.floatingHeight > content.height) {
      issues.push('floating panel extends beyond bottom edge');
      fields.add('floatingY');
      fields.add('floatingHeight');
    }
    return issues.length > 0 ? { issues, fields } : null;
  }, [panelLayout]);

  // Debounced persistence for palette tint — avoids hammering the backend during fast drags.
  const debouncePalettePersist = useCallback(
    (hue: number, saturation: number, brightness: number) => {
      if (palettePersistTimer.current) {
        clearTimeout(palettePersistTimer.current);
      }
      palettePersistTimer.current = setTimeout(() => {
        persistPaletteTint(resolvedTheme, hue, saturation, brightness);
        savePaletteTintToLocalStorage(resolvedTheme, hue, saturation, brightness);
      }, 300);
    },
    [resolvedTheme]
  );

  const handlePaletteHueChange = (value: number) => {
    setPaletteHue(value);
    applyTintedPalette(value, paletteSaturation, paletteBrightness);
    debouncePalettePersist(value, paletteSaturation, paletteBrightness);
  };

  const handlePaletteSaturationChange = (value: number) => {
    setPaletteSaturation(value);
    applyTintedPalette(paletteHue, value, paletteBrightness);
    debouncePalettePersist(paletteHue, value, paletteBrightness);
  };

  const handlePaletteBrightnessChange = (value: number) => {
    setPaletteBrightness(value);
    applyTintedPalette(paletteHue, paletteSaturation, value);
    debouncePalettePersist(paletteHue, paletteSaturation, value);
  };

  // Per-value reset handlers for individual palette controls.
  const handleHueReset = () => {
    setPaletteHue(0);
    applyTintedPalette(0, paletteSaturation, paletteBrightness);
    debouncePalettePersist(0, paletteSaturation, paletteBrightness);
  };

  const handleSaturationReset = () => {
    setPaletteSaturation(0);
    applyTintedPalette(paletteHue, 0, paletteBrightness);
    debouncePalettePersist(paletteHue, 0, paletteBrightness);
  };

  const handleBrightnessReset = () => {
    setPaletteBrightness(0);
    applyTintedPalette(paletteHue, paletteSaturation, 0);
    debouncePalettePersist(paletteHue, paletteSaturation, 0);
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

  // Debounced persistence for link color — same pattern as accent color.
  const debounceLinkPersist = useCallback(
    (color: string) => {
      if (linkPersistTimer.current) {
        clearTimeout(linkPersistTimer.current);
      }
      linkPersistTimer.current = setTimeout(() => {
        persistLinkColor(resolvedTheme, color);
        saveLinkColorToLocalStorage(resolvedTheme, color);
      }, 300);
    },
    [resolvedTheme]
  );

  const handleLinkColorChange = (hex: string) => {
    setLinkColorState(hex);
    applyLinkColor(hex, resolvedTheme);
    debounceLinkPersist(hex);
  };

  // Reset link color for the current resolved theme.
  const handleLinkReset = () => {
    setLinkColorState('');
    applyLinkColor('', resolvedTheme);
    persistLinkColor(resolvedTheme, '');
    saveLinkColorToLocalStorage(resolvedTheme, '');
  };

  // Inline hex editing handlers for link color.
  const defaultLink = resolvedTheme === 'light' ? '#525252' : '#aaaaaa';

  const handleLinkHexClick = () => {
    setLinkHexDraft(linkColor || defaultLink);
    setIsEditingLinkHex(true);
    requestAnimationFrame(() => linkHexInputRef.current?.select());
  };

  const handleLinkHexCommit = () => {
    let trimmed = linkHexDraft.trim().toLowerCase();
    if (!trimmed.startsWith('#')) trimmed = '#' + trimmed;
    // Expand shorthand #rgb → #rrggbb
    if (/^#[0-9a-f]{3}$/.test(trimmed)) {
      trimmed = '#' + trimmed[1] + trimmed[1] + trimmed[2] + trimmed[2] + trimmed[3] + trimmed[3];
    }
    if (validHexRe.test(trimmed)) {
      handleLinkColorChange(trimmed);
    }
    setIsEditingLinkHex(false);
  };

  const handleLinkHexCancel = () => {
    setIsEditingLinkHex(false);
  };

  // Palette value inline editing handlers — same pattern as accent hex editing.
  const handlePaletteValueClick = (field: 'hue' | 'saturation' | 'brightness') => {
    const current =
      field === 'hue' ? paletteHue : field === 'saturation' ? paletteSaturation : paletteBrightness;
    setPaletteDraft(String(current));
    setEditingPaletteField(field);
  };

  const handlePaletteValueCommit = () => {
    if (!editingPaletteField) return;
    const parsed = parseInt(paletteDraft, 10);
    if (isNaN(parsed)) {
      setEditingPaletteField(null);
      return;
    }
    if (editingPaletteField === 'hue') {
      handlePaletteHueChange(Math.max(0, Math.min(360, parsed)));
    } else if (editingPaletteField === 'saturation') {
      handlePaletteSaturationChange(Math.max(0, Math.min(100, parsed)));
    } else if (editingPaletteField === 'brightness') {
      handlePaletteBrightnessChange(Math.max(-50, Math.min(50, parsed)));
    }
    setEditingPaletteField(null);
  };

  const handlePaletteValueCancel = () => {
    setEditingPaletteField(null);
  };

  // Reload themes from backend.
  const reloadThemes = async () => {
    try {
      const result = await getThemes();
      setThemes(result);
    } catch (error) {
      errorHandler.handle(error, { action: 'loadThemes' });
    }
  };

  // Save current palette as a new theme.
  const handleSaveCurrentAsTheme = () => {
    setEditingThemeId('new');
    setThemeDraft({ name: '', clusterPattern: '' });
  };

  // Start inline editing a single field (name or pattern) on an existing theme row.
  const handleThemeFieldClick = (
    themeId: string,
    field: 'name' | 'clusterPattern',
    currentValue: string
  ) => {
    setThemeFieldDraft(currentValue);
    setEditingThemeField({ themeId, field });
  };

  // Commit the single-field inline edit for an existing theme.
  const handleThemeFieldCommit = async () => {
    if (!editingThemeField) return;
    const { themeId, field } = editingThemeField;
    const trimmed = themeFieldDraft.trim();

    // Name must not be empty; pattern can be empty.
    if (field === 'name' && !trimmed) {
      setEditingThemeField(null);
      return;
    }

    const existing = themes.find((t) => t.id === themeId);
    if (existing) {
      const updated = new types.Theme({
        ...existing,
        [field]: trimmed,
      });
      try {
        await saveTheme(updated);
        await reloadThemes();
      } catch (error) {
        errorHandler.handle(error, { action: 'saveTheme' });
      }
    }
    setEditingThemeField(null);
  };

  // Cancel the single-field inline edit.
  const handleThemeFieldCancel = () => {
    setEditingThemeField(null);
  };

  // Commit new theme creation (the "Save Current as Theme" form).
  const handleThemeSave = async () => {
    if (!themeDraft.name.trim()) return;

    try {
      // Create new theme capturing both light and dark palette values.
      const lightTint = getPaletteTint('light');
      const darkTint = getPaletteTint('dark');
      const newTheme = new types.Theme({
        id: crypto.randomUUID(),
        name: themeDraft.name.trim(),
        clusterPattern: themeDraft.clusterPattern.trim(),
        paletteHueLight: lightTint.hue,
        paletteSaturationLight: lightTint.saturation,
        paletteBrightnessLight: lightTint.brightness,
        paletteHueDark: darkTint.hue,
        paletteSaturationDark: darkTint.saturation,
        paletteBrightnessDark: darkTint.brightness,
        accentColorLight: getAccentColor('light'),
        accentColorDark: getAccentColor('dark'),
        linkColorLight: getLinkColor('light'),
        linkColorDark: getLinkColor('dark'),
      });
      await saveTheme(newTheme);
      await reloadThemes();
      setEditingThemeId(null);
    } catch (error) {
      errorHandler.handle(error, { action: 'saveTheme' });
    }
  };

  // Cancel editing.
  const handleThemeEditCancel = () => {
    setEditingThemeId(null);
  };

  // Delete a theme after confirmation.
  const handleDeleteThemeConfirm = async () => {
    if (!deleteConfirmThemeId) return;
    try {
      await deleteThemeApi(deleteConfirmThemeId);
      await reloadThemes();
    } catch (error) {
      errorHandler.handle(error, { action: 'deleteTheme' });
    } finally {
      setDeleteConfirmThemeId(null);
    }
  };

  // Apply a saved theme: copies its palette values into the active settings
  // and re-applies CSS overrides so the change is visible immediately.
  const handleApplyTheme = async (id: string) => {
    try {
      await applyThemeApi(id);
      setActiveThemeId(id);
      await hydrateAppPreferences({ force: true });

      // Re-apply CSS overrides for the current resolved theme.
      const currentTheme = resolvedTheme === 'dark' ? 'dark' : 'light';
      const tint = getPaletteTint(currentTheme);
      if (isPaletteActive(tint.saturation, tint.brightness)) {
        applyTintedPalette(tint.hue, tint.saturation, tint.brightness);
      } else {
        applyTintedPalette(0, 0, 0);
      }
      savePaletteTintToLocalStorage(currentTheme, tint.hue, tint.saturation, tint.brightness);

      const lightAccent = getAccentColor('light');
      const darkAccent = getAccentColor('dark');
      applyAccentColor(lightAccent, darkAccent);
      applyAccentBg(currentTheme === 'light' ? lightAccent : darkAccent, currentTheme);
      saveAccentColorToLocalStorage('light', lightAccent);
      saveAccentColorToLocalStorage('dark', darkAccent);

      // Apply link color overrides from the theme.
      const currentLinkColor = getLinkColor(currentTheme);
      applyLinkColor(currentLinkColor, currentTheme);
      saveLinkColorToLocalStorage('light', getLinkColor('light'));
      saveLinkColorToLocalStorage('dark', getLinkColor('dark'));

      // Update local slider/accent/link state to reflect the applied theme values.
      setPaletteHue(tint.hue);
      setPaletteSaturation(tint.saturation);
      setPaletteBrightness(tint.brightness);
      setAccentColorState(getAccentColor(currentTheme));
      setLinkColorState(getLinkColor(currentTheme));
    } catch (error) {
      errorHandler.handle(error, { action: 'applyTheme' });
    }
  };

  // Save the current palette/accent settings into an existing theme.
  const handleSaveToTheme = async (id: string) => {
    const existing = themes.find((t) => t.id === id);
    if (!existing) return;

    try {
      const lightTint = getPaletteTint('light');
      const darkTint = getPaletteTint('dark');
      const updated = new types.Theme({
        ...existing,
        paletteHueLight: lightTint.hue,
        paletteSaturationLight: lightTint.saturation,
        paletteBrightnessLight: lightTint.brightness,
        paletteHueDark: darkTint.hue,
        paletteSaturationDark: darkTint.saturation,
        paletteBrightnessDark: darkTint.brightness,
        accentColorLight: getAccentColor('light'),
        accentColorDark: getAccentColor('dark'),
        linkColorLight: getLinkColor('light'),
        linkColorDark: getLinkColor('dark'),
      });
      await saveTheme(updated);
      await reloadThemes();
      setActiveThemeId(null);
    } catch (error) {
      errorHandler.handle(error, { action: 'saveTheme' });
    }
  };

  // Check whether a theme already matches the current palette/accent settings.
  // Uses the live slider state for the active mode (avoids debounce lag from
  // the persisted preference cache) and getPaletteTint for the inactive mode.
  const themeMatchesCurrent = useCallback(
    (theme: types.Theme): boolean => {
      const isLight = resolvedTheme === 'light';

      // Active mode: compare against live slider / accent state.
      const activeHueMatch = isLight
        ? theme.paletteHueLight === paletteHue
        : theme.paletteHueDark === paletteHue;
      const activeSatMatch = isLight
        ? theme.paletteSaturationLight === paletteSaturation
        : theme.paletteSaturationDark === paletteSaturation;
      const activeBrtMatch = isLight
        ? theme.paletteBrightnessLight === paletteBrightness
        : theme.paletteBrightnessDark === paletteBrightness;
      const activeAccentMatch = isLight
        ? (theme.accentColorLight || '') === (accentColor || '')
        : (theme.accentColorDark || '') === (accentColor || '');
      const activeLinkMatch = isLight
        ? (theme.linkColorLight || '') === (linkColor || '')
        : (theme.linkColorDark || '') === (linkColor || '');

      // Inactive mode: compare against persisted preference cache.
      const otherTint = getPaletteTint(isLight ? 'dark' : 'light');
      const otherAccent = getAccentColor(isLight ? 'dark' : 'light');
      const otherLink = getLinkColor(isLight ? 'dark' : 'light');
      const otherHueMatch = isLight
        ? theme.paletteHueDark === otherTint.hue
        : theme.paletteHueLight === otherTint.hue;
      const otherSatMatch = isLight
        ? theme.paletteSaturationDark === otherTint.saturation
        : theme.paletteSaturationLight === otherTint.saturation;
      const otherBrtMatch = isLight
        ? theme.paletteBrightnessDark === otherTint.brightness
        : theme.paletteBrightnessLight === otherTint.brightness;
      const otherAccentMatch = isLight
        ? (theme.accentColorDark || '') === (otherAccent || '')
        : (theme.accentColorLight || '') === (otherAccent || '');
      const otherLinkMatch = isLight
        ? (theme.linkColorDark || '') === (otherLink || '')
        : (theme.linkColorLight || '') === (otherLink || '');

      return (
        activeHueMatch &&
        activeSatMatch &&
        activeBrtMatch &&
        activeAccentMatch &&
        activeLinkMatch &&
        otherHueMatch &&
        otherSatMatch &&
        otherBrtMatch &&
        otherAccentMatch &&
        otherLinkMatch
      );
    },
    [resolvedTheme, paletteHue, paletteSaturation, paletteBrightness, accentColor, linkColor]
  );

  // Drag-and-drop reorder handler.
  const handleThemeDrop = async (targetId: string) => {
    if (!draggingThemeId || draggingThemeId === targetId) {
      setDraggingThemeId(null);
      setDropTargetThemeId(null);
      return;
    }
    const ids = themes.map((t) => t.id);
    const fromIdx = ids.indexOf(draggingThemeId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    // Move item from fromIdx to toIdx.
    const reordered = [...ids];
    reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, draggingThemeId);

    try {
      await reorderThemes(reordered);
      await reloadThemes();
    } catch (error) {
      errorHandler.handle(error, { action: 'reorderThemes' });
    } finally {
      setDraggingThemeId(null);
      setDropTargetThemeId(null);
    }
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
      // Clear palette tint, accent color, and link color before reload so UI reverts immediately.
      clearTintedPalette();
      clearAccentColor();
      clearLinkColor();

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

  // Render an inline-editable value for a palette slider (hue, saturation, brightness).
  const renderEditableValue = (
    field: 'hue' | 'saturation' | 'brightness',
    value: number,
    suffix: string
  ) => {
    if (editingPaletteField === field) {
      return (
        <input
          ref={paletteInputRef}
          className="palette-slider-value palette-hex-input"
          value={paletteDraft}
          onChange={(e) => setPaletteDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handlePaletteValueCommit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              handlePaletteValueCancel();
            } else {
              e.stopPropagation();
            }
          }}
          onBlur={handlePaletteValueCancel}
          maxLength={4}
          spellCheck={false}
        />
      );
    }
    return (
      <span
        className="palette-slider-value palette-hex-clickable"
        onClick={() => handlePaletteValueClick(field)}
        title="Click to edit value"
      >
        {value > 0 && field === 'brightness' ? '+' : ''}
        {value}
        {suffix}
      </span>
    );
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
          {renderEditableValue('hue', paletteHue, '\u00B0')}
          <button
            type="button"
            className="palette-row-reset"
            onClick={handleHueReset}
            disabled={paletteHue === 0}
            title="Reset Hue"
          >
            ↺
          </button>

          <label htmlFor="palette-saturation">Saturation</label>
          <input
            type="range"
            id="palette-saturation"
            className="palette-slider palette-slider-saturation"
            min={0}
            max={100}
            value={paletteSaturation}
            onChange={(e) => handlePaletteSaturationChange(Number(e.target.value))}
            style={{
              background: `linear-gradient(to right, hsl(0, 0%, 50%), hsl(${paletteHue}, 20%, 50%))`,
            }}
          />
          {renderEditableValue('saturation', paletteSaturation, '%')}
          <button
            type="button"
            className="palette-row-reset"
            onClick={handleSaturationReset}
            disabled={paletteSaturation === 0}
            title="Reset Saturation"
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
          {renderEditableValue('brightness', paletteBrightness, '')}
          <button
            type="button"
            className="palette-row-reset"
            onClick={handleBrightnessReset}
            disabled={paletteBrightness === 0}
            title="Reset Brightness"
          >
            ↺
          </button>
        </div>
        {/* Color pickers row — Accent and Links side by side */}
        <div className="palette-color-controls">
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
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAccentHexCommit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  handleAccentHexCancel();
                } else e.stopPropagation();
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

          {/* Spacer column between Accent and Links */}
          <div className="palette-color-spacer" />

          <label>Links</label>
          <input
            type="color"
            className="palette-accent-swatch"
            value={linkColor || (resolvedTheme === 'light' ? '#525252' : '#aaaaaa')}
            onChange={(e) => handleLinkColorChange(e.target.value)}
          />
          {isEditingLinkHex ? (
            <input
              ref={linkHexInputRef}
              className="palette-slider-value palette-hex-input"
              value={linkHexDraft}
              onChange={(e) => setLinkHexDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleLinkHexCommit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  handleLinkHexCancel();
                } else e.stopPropagation();
              }}
              onBlur={handleLinkHexCancel}
              maxLength={7}
              spellCheck={false}
            />
          ) : (
            <span
              className="palette-slider-value palette-hex-clickable"
              onClick={handleLinkHexClick}
              title="Click to edit hex value"
            >
              {linkColor || defaultLink}
            </span>
          )}
          <button
            type="button"
            className="palette-row-reset"
            onClick={handleLinkReset}
            disabled={!linkColor}
            title="Reset Link Color"
          >
            ↺
          </button>

          <div className="palette-bottom-actions">
            {editingThemeId !== 'new' && (
              <>
                {activeThemeId && (
                  <>
                    <button
                      type="button"
                      className="button generic"
                      onClick={() => handleSaveToTheme(activeThemeId)}
                      disabled={themeMatchesCurrent(themes.find((t) => t.id === activeThemeId)!)}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="button generic"
                      onClick={async () => {
                        await handleApplyTheme(activeThemeId);
                        setActiveThemeId(null);
                      }}
                    >
                      Cancel
                    </button>
                  </>
                )}
                <button type="button" className="button generic" onClick={handleSaveCurrentAsTheme}>
                  Save New Theme
                </button>
              </>
            )}
          </div>
        </div>
        {editingThemeId === 'new' && (
          <div className="themes-new-form">
            <input
              className="theme-name-input"
              value={themeDraft.name}
              onChange={(e) => setThemeDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Theme name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleThemeSave();
                else if (e.key === 'Escape') handleThemeEditCancel();
                else e.stopPropagation();
              }}
            />
            <input
              className="theme-pattern-input"
              value={themeDraft.clusterPattern}
              onChange={(e) =>
                setThemeDraft((d) => ({
                  ...d,
                  clusterPattern: e.target.value,
                }))
              }
              placeholder="Cluster pattern (optional)"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleThemeSave();
                else if (e.key === 'Escape') handleThemeEditCancel();
                else e.stopPropagation();
              }}
            />
            <button type="button" className="button generic" onClick={handleThemeSave}>
              Save
            </button>
            <button type="button" className="button generic" onClick={handleThemeEditCancel}>
              Cancel
            </button>
          </div>
        )}
        {/* Saved Themes */}
        {(themesLoading || themes.length > 0) && (
          <div className="themes-section">
            <h4>Saved Themes</h4>
            {themesLoading ? (
              <div className="themes-loading">Loading themes...</div>
            ) : (
              <>
                <div className="themes-table">
                  <div className="themes-table-header">
                    <span className="themes-header-name">Theme Name</span>
                    <span>
                      Pattern{' '}
                      <Tooltip
                        content={
                          <>
                            Auto-apply the theme when the cluster name matches the pattern.
                            <br />
                            <br />
                            Supports wildcards <code>*</code> and <code>?</code>
                            <br />
                            <br />
                            Examples:
                            <br />
                            &nbsp;&nbsp;- <code>prod*</code> matches <code>prod-us</code> and{' '}
                            <code>prod-eu</code>
                            <br />
                            &nbsp;&nbsp;- <code>*</code> matches any name
                            <br />
                            <br />
                            First matching pattern will be applied. Use the drag handles to reorder
                            themes.
                          </>
                        }
                      />
                    </span>
                    <span></span>
                    <span></span>
                  </div>
                  {themes.map((theme) => {
                    const isDragging = theme.id === draggingThemeId;
                    const isDropTarget =
                      theme.id === dropTargetThemeId && theme.id !== draggingThemeId;
                    const isEditingName =
                      editingThemeField?.themeId === theme.id && editingThemeField.field === 'name';
                    const isEditingPattern =
                      editingThemeField?.themeId === theme.id &&
                      editingThemeField.field === 'clusterPattern';
                    return (
                      <div
                        key={theme.id}
                        className={`themes-table-row${isDragging ? ' themes-table-row--dragging' : ''}${isDropTarget ? ' themes-table-row--drop-target' : ''}${activeThemeId && activeThemeId !== theme.id ? ' themes-table-row--dimmed' : ''}`}
                        onDragOver={(e) => {
                          if (!draggingThemeId) return;
                          e.preventDefault();
                          setDropTargetThemeId(theme.id);
                        }}
                        onDragLeave={() => {
                          setDropTargetThemeId((c) => (c === theme.id ? null : c));
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          handleThemeDrop(theme.id);
                        }}
                      >
                        <span
                          className="themes-drag-handle"
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = 'move';
                            setDraggingThemeId(theme.id);
                          }}
                          onDragEnd={() => {
                            setDraggingThemeId(null);
                            setDropTargetThemeId(null);
                          }}
                          title="Drag to reorder"
                        >
                          &#x2807;
                        </span>
                        {/* Inline-editable name */}
                        {isEditingName ? (
                          <input
                            ref={themeFieldInputRef}
                            className="theme-name-input"
                            value={themeFieldDraft}
                            onChange={(e) => setThemeFieldDraft(e.target.value)}
                            placeholder="Theme name"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleThemeFieldCommit();
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                handleThemeFieldCancel();
                              } else {
                                e.stopPropagation();
                              }
                            }}
                            onBlur={handleThemeFieldCancel}
                          />
                        ) : (
                          <span
                            className="theme-name theme-field-clickable"
                            onClick={() => handleThemeFieldClick(theme.id, 'name', theme.name)}
                            title="Click to edit name"
                          >
                            {theme.name}
                          </span>
                        )}
                        {/* Inline-editable pattern */}
                        {isEditingPattern ? (
                          <input
                            ref={themeFieldInputRef}
                            className="theme-pattern-input"
                            value={themeFieldDraft}
                            onChange={(e) => setThemeFieldDraft(e.target.value)}
                            placeholder="e.g. prod*"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleThemeFieldCommit();
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                handleThemeFieldCancel();
                              } else {
                                e.stopPropagation();
                              }
                            }}
                            onBlur={handleThemeFieldCancel}
                          />
                        ) : (
                          <span
                            className="theme-pattern theme-field-clickable"
                            onClick={() =>
                              handleThemeFieldClick(
                                theme.id,
                                'clusterPattern',
                                theme.clusterPattern
                              )
                            }
                            title="Click to edit pattern"
                          >
                            {theme.clusterPattern || '\u2014'}
                          </span>
                        )}
                        <button
                          type="button"
                          className="theme-action-button"
                          onClick={() => handleApplyTheme(theme.id)}
                          title="Load this theme's settings"
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          className="theme-action-button theme-action-delete"
                          onClick={() => setDeleteConfirmThemeId(theme.id)}
                          title="Delete theme"
                        >
                          Delete
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
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
              Short resource names{' '}
              <Tooltip
                content='Display short resource names (e.g., "sts" instead of "StatefulSets").'
                variant="dark"
              />
            </label>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>Object Panel Defaults</h3>
        <div className="settings-items object-panel-defaults">
          <div className="setting-item setting-item-inline">
            <span className="opd-row-label">Position</span>
            <Dropdown
              options={objectPanelPositionOptions}
              value={objectPanelPosition}
              onChange={(val) => handleObjectPanelPositionChange(val as ObjectPanelPosition)}
              variant="outlined"
              ariaLabel="Default Object Panel position"
            />
          </div>
          <div className="setting-item setting-item-inline">
            <span className="opd-row-label">Docked</span>
            <span className="opd-field-label">Width</span>
            <input
              id="panel-docked-right-width"
              type="number"
              min={PANEL_DEFAULTS.RIGHT_MIN_WIDTH}
              max={9999}
              className={panelLayoutWarning?.fields.has('dockedRightWidth') ? 'opd-input-warn' : ''}
              value={panelLayoutInputs.dockedRightWidth}
              onChange={(e) => handlePanelLayoutInput('dockedRightWidth', e.target.value)}
              onBlur={() => handlePanelLayoutBlur('dockedRightWidth')}
              aria-label="Docked right width"
            />
            <span className="opd-unit-gap">px</span>
            <span className="opd-field-label">Height</span>
            <input
              id="panel-docked-bottom-height"
              type="number"
              min={PANEL_DEFAULTS.BOTTOM_MIN_HEIGHT}
              max={9999}
              className={
                panelLayoutWarning?.fields.has('dockedBottomHeight') ? 'opd-input-warn' : ''
              }
              value={panelLayoutInputs.dockedBottomHeight}
              onChange={(e) => handlePanelLayoutInput('dockedBottomHeight', e.target.value)}
              onBlur={() => handlePanelLayoutBlur('dockedBottomHeight')}
              aria-label="Docked bottom height"
            />
            <span>px</span>
          </div>
          <div className="setting-item setting-item-inline">
            <span className="opd-row-label">Floating</span>
            <span className="opd-field-label">Width</span>
            <input
              id="panel-floating-width"
              type="number"
              min={PANEL_DEFAULTS.FLOATING_MIN_WIDTH}
              max={9999}
              className={panelLayoutWarning?.fields.has('floatingWidth') ? 'opd-input-warn' : ''}
              value={panelLayoutInputs.floatingWidth}
              onChange={(e) => handlePanelLayoutInput('floatingWidth', e.target.value)}
              onBlur={() => handlePanelLayoutBlur('floatingWidth')}
              aria-label="Floating width"
            />
            <span className="opd-unit-gap">px</span>
            <span className="opd-field-label">Height</span>
            <input
              id="panel-floating-height"
              type="number"
              min={PANEL_DEFAULTS.FLOATING_MIN_HEIGHT}
              max={9999}
              className={panelLayoutWarning?.fields.has('floatingHeight') ? 'opd-input-warn' : ''}
              value={panelLayoutInputs.floatingHeight}
              onChange={(e) => handlePanelLayoutInput('floatingHeight', e.target.value)}
              onBlur={() => handlePanelLayoutBlur('floatingHeight')}
              aria-label="Floating height"
            />
            <span>px</span>
          </div>
          <div className="setting-item setting-item-inline">
            <span className="opd-row-label"></span>
            <span className="opd-field-label">Top</span>
            <input
              id="panel-floating-y"
              type="number"
              min={0}
              max={9999}
              className={panelLayoutWarning?.fields.has('floatingY') ? 'opd-input-warn' : ''}
              value={panelLayoutInputs.floatingY}
              onChange={(e) => handlePanelLayoutInput('floatingY', e.target.value)}
              onBlur={() => handlePanelLayoutBlur('floatingY')}
              aria-label="Floating top position"
            />
            <span className="opd-unit-gap">px</span>
            <span className="opd-field-label">Left</span>
            <input
              id="panel-floating-x"
              type="number"
              min={0}
              max={9999}
              className={panelLayoutWarning?.fields.has('floatingX') ? 'opd-input-warn' : ''}
              value={panelLayoutInputs.floatingX}
              onChange={(e) => handlePanelLayoutInput('floatingX', e.target.value)}
              onBlur={() => handlePanelLayoutBlur('floatingX')}
              aria-label="Floating left position"
            />
            <span>px</span>
          </div>
          {panelLayoutWarning && (
            <div className="setting-item opd-warning">
              <p>One or more values will be adjusted to fit at render time:</p>
              <ul>
                {panelLayoutWarning.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="settings-section">
        <h3>Advanced</h3>
        <div className="settings-subsection">
          <h4>Refresh</h4>
          <div className="settings-items">
            <div className="setting-item">
              <label htmlFor="refresh-enabled">
                <input
                  type="checkbox"
                  id="refresh-enabled"
                  checked={refreshEnabled}
                  onChange={(e) => handleRefreshToggle(e.target.checked)}
                />
                Enable auto-refresh{' '}
                <Tooltip
                  content="Automatically refresh resource data at regular intervals to keep views up to date."
                  variant="dark"
                />
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
                Include background clusters in auto-refresh{' '}
                <Tooltip
                  content="When enabled, clusters that are not actively selected will also be refreshed in the background so their data stays current when you switch to them."
                  variant="dark"
                />
              </label>
            </div>
          </div>
        </div>
        <div className="settings-subsection">
          <h4>Pod Logs</h4>
          <div className="settings-items">
            <div className="setting-item setting-item-inline">
              <label htmlFor="log-buffer-max-size">Max logs </label>
              <input
                type="number"
                id="log-buffer-max-size"
                min={LOG_BUFFER_MIN_SIZE}
                max={LOG_BUFFER_MAX_SIZE}
                step={100}
                value={logBufferMaxSizeInput}
                onChange={(e) => setLogBufferMaxSizeInput(e.target.value)}
                onBlur={(e) => commitLogBufferMaxSize(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitLogBufferMaxSize((e.target as HTMLInputElement).value);
                  }
                }}
              />
              <Tooltip
                content={
                  <>
                    <p>
                      Max number of logs in the pod logs viewer. Larger values use more memory but
                      give deeper scrollback.
                    </p>
                    <p style={{ marginTop: '1em' }}>
                      Range {LOG_BUFFER_MIN_SIZE}-{LOG_BUFFER_MAX_SIZE}, default{' '}
                      {LOG_BUFFER_DEFAULT_SIZE}
                    </p>
                  </>
                }
                variant="dark"
              />
            </div>
            <div className="setting-item setting-item-inline">
              <label htmlFor="log-target-per-scope-limit">Max log targets per tab </label>
              <input
                type="number"
                id="log-target-per-scope-limit"
                min={LOG_TARGET_PER_SCOPE_MIN}
                max={LOG_TARGET_PER_SCOPE_MAX}
                step={1}
                value={logTargetPerScopeLimitInput}
                onChange={(e) => setLogTargetPerScopeLimitInput(e.target.value)}
                onBlur={(e) => commitLogTargetPerScopeLimit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitLogTargetPerScopeLimit((e.target as HTMLInputElement).value);
                  }
                }}
              />
              <Tooltip
                content={
                  <>
                    <p>
                      Max pod/container log targets a single Logs tab can stream or fetch at once.
                    </p>
                    <p style={{ marginTop: '1em' }}>
                      Range {LOG_TARGET_PER_SCOPE_MIN}-{LOG_TARGET_PER_SCOPE_MAX}, default{' '}
                      {LOG_TARGET_PER_SCOPE_DEFAULT}
                    </p>
                  </>
                }
                variant="dark"
              />
            </div>
            <div className="setting-item setting-item-inline">
              <label htmlFor="log-target-global-limit">Max log targets across tabs </label>
              <input
                type="number"
                id="log-target-global-limit"
                min={LOG_TARGET_GLOBAL_MIN}
                max={LOG_TARGET_GLOBAL_MAX}
                step={1}
                value={logTargetGlobalLimitInput}
                onChange={(e) => setLogTargetGlobalLimitInput(e.target.value)}
                onBlur={(e) => commitLogTargetGlobalLimit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitLogTargetGlobalLimit((e.target as HTMLInputElement).value);
                  }
                }}
              />
              <Tooltip
                content={
                  <>
                    <p>
                      Max pod/container log targets shared across all open Logs tabs. Lower values
                      reduce overall load but can cap large workloads sooner.
                    </p>
                    <p style={{ marginTop: '1em' }}>
                      Range {LOG_TARGET_GLOBAL_MIN}-{LOG_TARGET_GLOBAL_MAX}, default{' '}
                      {LOG_TARGET_GLOBAL_DEFAULT}
                    </p>
                  </>
                }
                variant="dark"
              />
            </div>
            <div className="setting-item">
              <label htmlFor="log-api-timestamp-local-time-zone">
                <input
                  type="checkbox"
                  id="log-api-timestamp-local-time-zone"
                  checked={logApiTimestampUseLocalTimeZone}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setLogApiTimestampUseLocalTimeZoneState(enabled);
                    setLogApiTimestampUseLocalTimeZone(enabled);
                  }}
                />
                Show API timestamps in the local time zone{' '}
                <Tooltip
                  content="Formats Kubernetes API timestamps using this machine's local timezone instead of UTC."
                  variant="dark"
                />
              </label>
            </div>
            <div className="setting-item">
              <div className="setting-item-inline">
                <label htmlFor="log-api-timestamp-format">API timestamp format </label>
                <input
                  type="text"
                  id="log-api-timestamp-format"
                  value={logApiTimestampFormatInput}
                  onChange={(e) => {
                    setLogApiTimestampFormatInput(e.target.value);
                    if (logApiTimestampFormatError) {
                      setLogApiTimestampFormatError(null);
                    }
                  }}
                  onBlur={(e) => commitLogApiTimestampFormat(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      commitLogApiTimestampFormat((e.target as HTMLInputElement).value);
                    }
                  }}
                  className={logApiTimestampFormatError ? 'setting-input-error' : undefined}
                  aria-invalid={logApiTimestampFormatError ? 'true' : 'false'}
                />
                <Tooltip
                  content={
                    <>
                      <p>Day.js pattern used for the Kubernetes API timestamp shown in pod logs.</p>
                      <p style={{ marginTop: '1em' }}>
                        Examples: <code>YYYY-MM-DDTHH:mm:ss.SSS[Z]</code>, <code>HH:mm:ss.SSS</code>
                        , <code>[ts=]HH:mm:ss.SSS</code>, <code>YYYY-MM-DD HH:mm:ss Z</code>
                      </p>
                      <p style={{ marginTop: '1em' }}>
                        Wrap literal text in square brackets. Unsupported tokens are rejected.
                      </p>
                      <p style={{ marginTop: '1em' }}>
                        Use <code>Z</code> or <code>ZZ</code> if you want the timezone offset shown
                        in local-time mode.
                      </p>
                    </>
                  }
                  variant="dark"
                />
              </div>
              {logApiTimestampFormatError ? (
                <div className="setting-item-message setting-item-error" role="alert">
                  {logApiTimestampFormatError}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="settings-subsection">
          <h4>Persistence</h4>
          <div className="settings-items">
            <div className="setting-item">
              <label htmlFor="persist-namespaced">
                <input
                  type="checkbox"
                  id="persist-namespaced"
                  checked={persistenceMode === 'namespaced'}
                  onChange={(e) => handlePersistenceModeToggle(e.target.checked)}
                />
                Enable per-namespace view settings{' '}
                <Tooltip
                  content="Save separate column, sorting, and filter settings for each namespace instead of sharing a single view across all namespaces."
                  variant="dark"
                />
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
      </div>
      <ConfirmationModal
        isOpen={deleteConfirmThemeId !== null}
        title="Delete Theme"
        message={`Delete "${themes.find((t) => t.id === deleteConfirmThemeId)?.name || 'this theme'}"?`}
        confirmText="Confirm"
        confirmButtonClass="danger"
        onConfirm={handleDeleteThemeConfirm}
        onCancel={() => setDeleteConfirmThemeId(null)}
      />
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
        message="⚠️ This will clear ALL saved state (preferences, favorites, view settings, etc.) and restart the app. Are you sure?"
        confirmText="Confirm"
        confirmButtonClass="danger"
        onConfirm={handleClearAllState}
        onCancel={() => setIsClearStateConfirmOpen(false)}
      />
    </div>
  );
}

export default Settings;

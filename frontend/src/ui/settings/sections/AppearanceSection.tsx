/**
 * frontend/src/ui/settings/sections/AppearanceSection.tsx
 *
 * Appearance tab content: Mode (System/Light/Dark) + Theme (tint sliders,
 * accent, link, saved themes).
 */

import { useState, useEffect, useRef, useCallback, type CSSProperties } from 'react';
import { types } from '@wailsjs/go/models';
import { errorHandler } from '@utils/errorHandler';
import { changeAppearanceMode } from '@/utils/appearanceMode';
import {
  hydrateAppPreferences,
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
import { useAppearanceMode } from '@/core/contexts/AppearanceModeContext';
import {
  applyTintedPalette,
  savePaletteTintToLocalStorage,
  isPaletteActive,
  MAX_SATURATION,
  MAX_BRIGHTNESS_OFFSET,
} from '@utils/paletteTint';
import { applyAccentColor, applyAccentBg, saveAccentColorToLocalStorage } from '@utils/accentColor';
import { applyLinkColor, saveLinkColorToLocalStorage } from '@utils/linkColor';
import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import SegmentedButton from '@shared/components/SegmentedButton';
import { EditIcon, DeleteIcon, CheckIcon, CloseIcon } from '@shared/components/icons/MenuIcons';

const DEFAULT_THEME_ID = 'default';

const isDefaultTheme = (theme: types.Theme) => theme.id === DEFAULT_THEME_ID;

type PaletteSliderStyle = CSSProperties & {
  '--palette-slider-thumb'?: string;
};

const buildPaletteSliderStyle = (thumbColor: string, background?: string): PaletteSliderStyle => ({
  '--palette-slider-thumb': thumbColor,
  ...(background ? { background } : {}),
});

function AppearanceSection() {
  const { mode, resolvedMode } = useAppearanceMode();

  // Palette tint state for hue/saturation/brightness sliders.
  const [paletteHue, setPaletteHue] = useState(0);
  const [paletteSaturation, setPaletteSaturation] = useState(0);
  const [paletteBrightness, setPaletteBrightness] = useState(0);
  const palettePersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Accent color state.
  const [accentColor, setAccentColorState] = useState('');
  const accentPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isEditingAccentHex, setIsEditingAccentHex] = useState(false);
  const [accentHexDraft, setAccentHexDraft] = useState('');
  const accentHexInputRef = useRef<HTMLInputElement>(null);

  // Link color state.
  const [linkColor, setLinkColorState] = useState('');
  const linkPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isEditingLinkHex, setIsEditingLinkHex] = useState(false);
  const [linkHexDraft, setLinkHexDraft] = useState('');
  const linkHexInputRef = useRef<HTMLInputElement>(null);

  // Inline editing for palette slider values.
  const [editingPaletteField, setEditingPaletteField] = useState<
    'hue' | 'saturation' | 'brightness' | null
  >(null);
  const [paletteDraft, setPaletteDraft] = useState('');
  const paletteInputRef = useRef<HTMLInputElement>(null);

  // Saved themes.
  const [themes, setThemes] = useState<types.Theme[]>([]);
  const [themesLoading, setThemesLoading] = useState(false);
  const [activeThemeId, setActiveThemeId] = useState<string | null>(null);
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null);
  const [themeDraft, setThemeDraft] = useState({ name: '', clusterPattern: '' });
  const [draggingThemeId, setDraggingThemeId] = useState<string | null>(null);
  const [dropTargetThemeId, setDropTargetThemeId] = useState<string | null>(null);
  const [deleteConfirmThemeId, setDeleteConfirmThemeId] = useState<string | null>(null);
  const [hasUnsavedDefaultThemeChanges, setHasUnsavedDefaultThemeChanges] = useState(false);

  // Load saved themes once on mount.
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

  // Reload slider/accent/link values when the resolved appearance mode changes.
  useEffect(() => {
    const tint = getPaletteTint(resolvedMode);
    setPaletteHue(tint.hue);
    setPaletteSaturation(tint.saturation);
    setPaletteBrightness(tint.brightness);
    setAccentColorState(getAccentColor(resolvedMode));
    setLinkColorState(getLinkColor(resolvedMode));
  }, [resolvedMode]);

  // Auto-focus the palette inline edit input when it appears.
  useEffect(() => {
    if (editingPaletteField && paletteInputRef.current) {
      paletteInputRef.current.focus();
      paletteInputRef.current.select();
    }
  }, [editingPaletteField]);

  // Clean up persist timers on unmount.
  useEffect(() => {
    return () => {
      if (palettePersistTimer.current) clearTimeout(palettePersistTimer.current);
      if (accentPersistTimer.current) clearTimeout(accentPersistTimer.current);
      if (linkPersistTimer.current) clearTimeout(linkPersistTimer.current);
    };
  }, []);

  const handleAppearanceModeChange = async (nextMode: string) => {
    try {
      if (nextMode !== 'light' && nextMode !== 'dark' && nextMode !== 'system') {
        return;
      }
      await changeAppearanceMode(nextMode);
    } catch (error) {
      errorHandler.handle(error, { action: 'setAppearanceMode', mode: nextMode });
    }
  };

  const flagUnsavedDefaultThemeChange = () => {
    if (activeThemeId === null) {
      setHasUnsavedDefaultThemeChanges(true);
    }
  };

  // Debounced palette tint persistence — avoids backend hammering during fast drags.
  const debouncePalettePersist = useCallback(
    (hue: number, saturation: number, brightness: number) => {
      if (palettePersistTimer.current) clearTimeout(palettePersistTimer.current);
      palettePersistTimer.current = setTimeout(() => {
        persistPaletteTint(resolvedMode, hue, saturation, brightness);
        savePaletteTintToLocalStorage(resolvedMode, hue, saturation, brightness);
      }, 300);
    },
    [resolvedMode]
  );

  const handlePaletteHueChange = (value: number) => {
    flagUnsavedDefaultThemeChange();
    setPaletteHue(value);
    applyTintedPalette(value, paletteSaturation, paletteBrightness);
    debouncePalettePersist(value, paletteSaturation, paletteBrightness);
  };

  const handlePaletteSaturationChange = (value: number) => {
    flagUnsavedDefaultThemeChange();
    setPaletteSaturation(value);
    applyTintedPalette(paletteHue, value, paletteBrightness);
    debouncePalettePersist(paletteHue, value, paletteBrightness);
  };

  const handlePaletteBrightnessChange = (value: number) => {
    flagUnsavedDefaultThemeChange();
    setPaletteBrightness(value);
    applyTintedPalette(paletteHue, paletteSaturation, value);
    debouncePalettePersist(paletteHue, paletteSaturation, value);
  };

  const handleHueReset = () => {
    flagUnsavedDefaultThemeChange();
    setPaletteHue(0);
    applyTintedPalette(0, paletteSaturation, paletteBrightness);
    debouncePalettePersist(0, paletteSaturation, paletteBrightness);
  };

  const handleSaturationReset = () => {
    flagUnsavedDefaultThemeChange();
    setPaletteSaturation(0);
    applyTintedPalette(paletteHue, 0, paletteBrightness);
    debouncePalettePersist(paletteHue, 0, paletteBrightness);
  };

  const handleBrightnessReset = () => {
    flagUnsavedDefaultThemeChange();
    setPaletteBrightness(0);
    applyTintedPalette(paletteHue, paletteSaturation, 0);
    debouncePalettePersist(paletteHue, paletteSaturation, 0);
  };

  const debounceAccentPersist = useCallback(
    (color: string) => {
      if (accentPersistTimer.current) clearTimeout(accentPersistTimer.current);
      accentPersistTimer.current = setTimeout(() => {
        persistAccentColor(resolvedMode, color);
        saveAccentColorToLocalStorage(resolvedMode, color);
      }, 300);
    },
    [resolvedMode]
  );

  const handleAccentColorChange = (hex: string) => {
    flagUnsavedDefaultThemeChange();
    setAccentColorState(hex);
    applyAccentColor(
      resolvedMode === 'light' ? hex : getAccentColor('light'),
      resolvedMode === 'dark' ? hex : getAccentColor('dark')
    );
    applyAccentBg(hex, resolvedMode);
    debounceAccentPersist(hex);
  };

  const handleAccentReset = () => {
    flagUnsavedDefaultThemeChange();
    if (accentPersistTimer.current) {
      clearTimeout(accentPersistTimer.current);
      accentPersistTimer.current = null;
    }
    setAccentColorState('');
    applyAccentColor(
      resolvedMode === 'light' ? '' : getAccentColor('light'),
      resolvedMode === 'dark' ? '' : getAccentColor('dark')
    );
    applyAccentBg('', resolvedMode);
    persistAccentColor(resolvedMode, '');
    saveAccentColorToLocalStorage(resolvedMode, '');
  };

  const validHexRe = /^#[0-9a-fA-F]{6}$/;
  const defaultAccent = resolvedMode === 'light' ? '#326ce5' : '#f59e0b';

  const handleAccentHexClick = () => {
    setAccentHexDraft(accentColor || defaultAccent);
    setIsEditingAccentHex(true);
    requestAnimationFrame(() => accentHexInputRef.current?.select());
  };

  const handleAccentHexCommit = () => {
    let trimmed = accentHexDraft.trim().toLowerCase();
    if (!trimmed.startsWith('#')) trimmed = '#' + trimmed;
    if (/^#[0-9a-f]{3}$/.test(trimmed)) {
      trimmed = '#' + trimmed[1] + trimmed[1] + trimmed[2] + trimmed[2] + trimmed[3] + trimmed[3];
    }
    if (validHexRe.test(trimmed)) {
      handleAccentColorChange(trimmed);
    }
    setIsEditingAccentHex(false);
  };

  const handleAccentHexCancel = () => setIsEditingAccentHex(false);

  const debounceLinkPersist = useCallback(
    (color: string) => {
      if (linkPersistTimer.current) clearTimeout(linkPersistTimer.current);
      linkPersistTimer.current = setTimeout(() => {
        persistLinkColor(resolvedMode, color);
        saveLinkColorToLocalStorage(resolvedMode, color);
      }, 300);
    },
    [resolvedMode]
  );

  const handleLinkColorChange = (hex: string) => {
    flagUnsavedDefaultThemeChange();
    setLinkColorState(hex);
    applyLinkColor(hex, resolvedMode);
    debounceLinkPersist(hex);
  };

  const handleLinkReset = () => {
    flagUnsavedDefaultThemeChange();
    if (linkPersistTimer.current) {
      clearTimeout(linkPersistTimer.current);
      linkPersistTimer.current = null;
    }
    setLinkColorState('');
    applyLinkColor('', resolvedMode);
    persistLinkColor(resolvedMode, '');
    saveLinkColorToLocalStorage(resolvedMode, '');
  };

  const defaultLink = resolvedMode === 'light' ? '#525252' : '#aaaaaa';

  const handleLinkHexClick = () => {
    setLinkHexDraft(linkColor || defaultLink);
    setIsEditingLinkHex(true);
    requestAnimationFrame(() => linkHexInputRef.current?.select());
  };

  const handleLinkHexCommit = () => {
    let trimmed = linkHexDraft.trim().toLowerCase();
    if (!trimmed.startsWith('#')) trimmed = '#' + trimmed;
    if (/^#[0-9a-f]{3}$/.test(trimmed)) {
      trimmed = '#' + trimmed[1] + trimmed[1] + trimmed[2] + trimmed[2] + trimmed[3] + trimmed[3];
    }
    if (validHexRe.test(trimmed)) {
      handleLinkColorChange(trimmed);
    }
    setIsEditingLinkHex(false);
  };

  const handleLinkHexCancel = () => setIsEditingLinkHex(false);

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

  const handlePaletteValueCancel = () => setEditingPaletteField(null);

  const reloadThemes = async () => {
    try {
      const result = await getThemes();
      setThemes(result);
    } catch (error) {
      errorHandler.handle(error, { action: 'loadThemes' });
    }
  };

  const handleSaveCurrentAsTheme = () => {
    setEditingThemeId('new');
    setThemeDraft({ name: '', clusterPattern: '' });
  };

  // Enter edit mode for an existing theme: applies the theme to the live UI
  // (so palette sliders/colors reflect it) and seeds the row inputs with the
  // theme's current name and pattern. Save / Cancel icons drive commit/revert.
  const handleEnterEditMode = (theme: types.Theme) => {
    setThemeDraft({ name: theme.name, clusterPattern: theme.clusterPattern });
    if (isDefaultTheme(theme) && hasUnsavedDefaultThemeChanges) {
      setActiveThemeId(theme.id);
      return;
    }
    handleApplyTheme(theme.id);
  };

  // Commit the active theme's edits (palette + name/pattern from themeDraft).
  const handleSaveActiveTheme = async () => {
    if (!activeThemeId) return;
    const existing = themes.find((t) => t.id === activeThemeId);
    if (!existing) return;
    const trimmedName = themeDraft.name.trim();
    if (!trimmedName) return; // Name is required.

    try {
      const isDefault = existing.id === DEFAULT_THEME_ID;
      const updated = buildThemeFromCurrentAppearance({
        theme: existing,
        name: isDefault ? existing.name : trimmedName,
        clusterPattern: isDefault ? '' : themeDraft.clusterPattern.trim(),
      });
      await saveTheme(updated);
      await reloadThemes();
      setActiveThemeId(null);
      if (isDefault) {
        setHasUnsavedDefaultThemeChanges(false);
      }
    } catch (error) {
      errorHandler.handle(error, { action: 'saveTheme' });
    }
  };

  // Cancel: re-apply the saved theme values and exit edit mode.
  const handleCancelActiveTheme = async () => {
    if (!activeThemeId) return;
    await handleApplyTheme(activeThemeId);
    setActiveThemeId(null);
    if (activeThemeId === DEFAULT_THEME_ID) {
      setHasUnsavedDefaultThemeChanges(false);
    }
  };

  const handleThemeSave = async () => {
    if (!themeDraft.name.trim()) return;

    try {
      const newTheme = buildThemeFromCurrentAppearance({
        theme: new types.Theme({
          id: crypto.randomUUID(),
          name: themeDraft.name.trim(),
          clusterPattern: themeDraft.clusterPattern.trim(),
        }),
      });
      await saveTheme(newTheme);
      await reloadThemes();
      setEditingThemeId(null);
    } catch (error) {
      errorHandler.handle(error, { action: 'saveTheme' });
    }
  };

  const handleThemeEditCancel = () => setEditingThemeId(null);

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

  const handleApplyTheme = async (id: string) => {
    try {
      await applyThemeApi(id);
      setActiveThemeId(id);
      setHasUnsavedDefaultThemeChanges(false);
      await hydrateAppPreferences({ force: true });

      const currentMode = resolvedMode === 'dark' ? 'dark' : 'light';
      const tint = getPaletteTint(currentMode);
      if (isPaletteActive(tint.saturation, tint.brightness)) {
        applyTintedPalette(tint.hue, tint.saturation, tint.brightness);
      } else {
        applyTintedPalette(0, 0, 0);
      }
      savePaletteTintToLocalStorage(currentMode, tint.hue, tint.saturation, tint.brightness);

      const lightAccent = getAccentColor('light');
      const darkAccent = getAccentColor('dark');
      applyAccentColor(lightAccent, darkAccent);
      applyAccentBg(currentMode === 'light' ? lightAccent : darkAccent, currentMode);
      saveAccentColorToLocalStorage('light', lightAccent);
      saveAccentColorToLocalStorage('dark', darkAccent);

      const currentLinkColor = getLinkColor(currentMode);
      applyLinkColor(currentLinkColor, currentMode);
      saveLinkColorToLocalStorage('light', getLinkColor('light'));
      saveLinkColorToLocalStorage('dark', getLinkColor('dark'));

      setPaletteHue(tint.hue);
      setPaletteSaturation(tint.saturation);
      setPaletteBrightness(tint.brightness);
      setAccentColorState(getAccentColor(currentMode));
      setLinkColorState(getLinkColor(currentMode));
    } catch (error) {
      errorHandler.handle(error, { action: 'applyTheme' });
    }
  };

  // True when the current live values match the saved theme exactly.
  const themeMatchesCurrent = useCallback(
    (theme: types.Theme): boolean => {
      const isLight = resolvedMode === 'light';

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
    [resolvedMode, paletteHue, paletteSaturation, paletteBrightness, accentColor, linkColor]
  );

  const defaultTheme = themes.find(isDefaultTheme) ?? null;

  function buildThemeFromCurrentAppearance({
    theme,
    name = theme.name,
    clusterPattern = theme.clusterPattern,
  }: {
    theme: types.Theme;
    name?: string;
    clusterPattern?: string;
  }): types.Theme {
    const isLight = resolvedMode === 'light';
    const otherMode = isLight ? 'dark' : 'light';
    const otherTint = getPaletteTint(otherMode);
    const otherAccent = getAccentColor(otherMode);
    const otherLink = getLinkColor(otherMode);

    return new types.Theme({
      ...theme,
      name,
      clusterPattern,
      paletteHueLight: isLight ? paletteHue : otherTint.hue,
      paletteSaturationLight: isLight ? paletteSaturation : otherTint.saturation,
      paletteBrightnessLight: isLight ? paletteBrightness : otherTint.brightness,
      paletteHueDark: isLight ? otherTint.hue : paletteHue,
      paletteSaturationDark: isLight ? otherTint.saturation : paletteSaturation,
      paletteBrightnessDark: isLight ? otherTint.brightness : paletteBrightness,
      accentColorLight: isLight ? accentColor : otherAccent,
      accentColorDark: isLight ? otherAccent : accentColor,
      linkColorLight: isLight ? linkColor : otherLink,
      linkColorDark: isLight ? otherLink : linkColor,
    });
  }

  const handleSaveDefaultThemeFromPrompt = async () => {
    if (!defaultTheme) return;
    try {
      await saveTheme(
        buildThemeFromCurrentAppearance({
          theme: defaultTheme,
          name: defaultTheme.name,
          clusterPattern: '',
        })
      );
      await reloadThemes();
      setHasUnsavedDefaultThemeChanges(false);
    } catch (error) {
      errorHandler.handle(error, { action: 'saveDefaultTheme' });
    }
  };

  const handleThemeDrop = async (targetId: string) => {
    if (
      !draggingThemeId ||
      draggingThemeId === targetId ||
      draggingThemeId === DEFAULT_THEME_ID ||
      targetId === DEFAULT_THEME_ID
    ) {
      setDraggingThemeId(null);
      setDropTargetThemeId(null);
      return;
    }
    const ids = themes.map((t) => t.id);
    const fromIdx = ids.indexOf(draggingThemeId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;

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

  const saturationOffset = (paletteSaturation / 100) * MAX_SATURATION;
  const brightnessLightness = Math.min(
    99,
    Math.max(1, 50 + (paletteBrightness / 50) * MAX_BRIGHTNESS_OFFSET)
  );
  const hueSliderStyle = buildPaletteSliderStyle(`hsl(${paletteHue}, 100%, 50%)`);
  const saturationSliderStyle = buildPaletteSliderStyle(
    `hsl(${paletteHue}, ${saturationOffset}%, 50%)`,
    `linear-gradient(to right, hsl(0, 0%, 50%), hsl(${paletteHue}, ${MAX_SATURATION}%, 50%))`
  );
  const brightnessSliderStyle = buildPaletteSliderStyle(
    `hsl(${paletteHue}, ${saturationOffset}%, ${brightnessLightness}%)`
  );

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
    <div className="settings-panel">
      <h2 className="settings-panel-title">Appearance</h2>

      <div className="settings-subgroup-label">Mode</div>
      <hr className="settings-subgroup-divider" />

      <div className="settings-row">
        <div className="settings-row-label">
          <div className="settings-row-label-title">Mode</div>
          <div className="settings-row-label-help">Match the system or pick a fixed mode.</div>
        </div>
        <div className="settings-row-control">
          <SegmentedButton
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            value={mode}
            onChange={handleAppearanceModeChange}
          />
        </div>
      </div>

      <div className="settings-subgroup-label">Theme</div>
      <hr className="settings-subgroup-divider" />

      <div className="settings-row">
        <div className="settings-row-label">
          <div className="settings-row-label-title">Tint</div>
          <div className="settings-row-label-help">
            Overall tint in the UI. Hue sets the color, saturation increases the strength, and
            brightness lightens or darkens.
          </div>
        </div>
        <div className="settings-row-control">
          <div className="palette-tint-controls">
            <label htmlFor="palette-hue">Hue</label>
            <input
              type="range"
              id="palette-hue"
              className="palette-slider palette-slider-hue"
              min={0}
              max={360}
              value={paletteHue}
              onChange={(e) => handlePaletteHueChange(Number(e.target.value))}
              style={hueSliderStyle}
            />
            {renderEditableValue('hue', paletteHue, '°')}
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
              style={saturationSliderStyle}
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
              style={brightnessSliderStyle}
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
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-label">
          <div className="settings-row-label-title">Accent color</div>
          <div className="settings-row-label-help">
            Used for active states, focus, and other elements that require emphasis.
          </div>
        </div>
        <div className="settings-row-control">
          <div className="palette-color-field">
            <input
              type="color"
              className="palette-accent-swatch"
              value={accentColor || defaultAccent}
              onChange={(e) => handleAccentColorChange(e.target.value)}
            />
            {isEditingAccentHex ? (
              <input
                ref={accentHexInputRef}
                className="color-swatch-value palette-hex-input"
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
              />
            ) : (
              <span
                className="color-swatch-value palette-hex-clickable"
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
          </div>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-label">
          <div className="settings-row-label-title">Link color</div>
          <div className="settings-row-label-help">
            Color of inline links in throughout the app.
          </div>
        </div>
        <div className="settings-row-control">
          <div className="palette-color-field">
            <input
              type="color"
              className="palette-accent-swatch"
              value={linkColor || defaultLink}
              onChange={(e) => handleLinkColorChange(e.target.value)}
            />
            {isEditingLinkHex ? (
              <input
                ref={linkHexInputRef}
                className="color-swatch-value palette-hex-input"
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
              />
            ) : (
              <span
                className="color-swatch-value palette-hex-clickable"
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
          </div>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-label">
          <div className="settings-row-label-title">Saved themes</div>
          <div className="settings-row-label-help">
            {}
            Themes can be automatically applied to clusters whose name matches the pattern.
            <ul className="themes-help-list">
              <li>
                Patterns support <code>*</code> <code>?</code> and simple regex like{' '}
                <code>[a-z]</code>
              </li>
              <li>Themes applied based on first match.</li>
              <li>Empty patterns match any cluster name.</li>
              <li>Use the drag handles to change order.</li>
              <li>Default theme always resolves last.</li>
            </ul>
            {}
          </div>
        </div>
        <div className="settings-row-control">
          <div className="themes-section">
            {themesLoading ? (
              <div className="themes-loading">Loading themes...</div>
            ) : (
              <div className="themes-table">
                {hasUnsavedDefaultThemeChanges &&
                  activeThemeId !== DEFAULT_THEME_ID &&
                  defaultTheme && (
                    <div className="themes-unsaved-default" role="status">
                      <span>
                        There are unsaved changes. Would you like to save them as the default theme?
                      </span>
                      <button
                        type="button"
                        className="themes-unsaved-default-action"
                        onClick={handleSaveDefaultThemeFromPrompt}
                      >
                        Save
                      </button>
                    </div>
                  )}
                {themes.map((theme) => {
                  const isDefault = isDefaultTheme(theme);
                  const isDragging = theme.id === draggingThemeId;
                  const isDropTarget =
                    theme.id === dropTargetThemeId && theme.id !== draggingThemeId && !isDefault;
                  return (
                    <div
                      key={theme.id}
                      className={`themes-table-row${isDragging ? ' themes-table-row--dragging' : ''}${isDropTarget ? ' themes-table-row--drop-target' : ''}${activeThemeId && activeThemeId !== theme.id ? ' themes-table-row--dimmed' : ''}`}
                      onDragOver={(e) => {
                        if (!draggingThemeId || isDefault) return;
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
                      {isDefault ? (
                        <span className="themes-drag-handle themes-drag-handle--placeholder"></span>
                      ) : (
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
                          &#x283F;
                        </span>
                      )}
                      {activeThemeId === theme.id && !isDefault ? (
                        <div className="theme-fields">
                          <input
                            className="theme-name-input"
                            value={themeDraft.name}
                            onChange={(e) => setThemeDraft((d) => ({ ...d, name: e.target.value }))}
                            placeholder="Theme name"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveActiveTheme();
                              else if (e.key === 'Escape') handleCancelActiveTheme();
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
                              if (e.key === 'Enter') handleSaveActiveTheme();
                              else if (e.key === 'Escape') handleCancelActiveTheme();
                              else e.stopPropagation();
                            }}
                          />
                        </div>
                      ) : (
                        <div className="theme-summary">
                          <span className="theme-name">{theme.name}</span>
                          <span className="theme-pattern">{theme.clusterPattern || '*'}</span>
                        </div>
                      )}
                      {activeThemeId === theme.id ? (
                        <>
                          <button
                            type="button"
                            className="theme-action-button"
                            onClick={handleSaveActiveTheme}
                            disabled={
                              themeMatchesCurrent(theme) &&
                              (isDefault ||
                                (themeDraft.name === theme.name &&
                                  themeDraft.clusterPattern === theme.clusterPattern))
                            }
                            aria-label="Save changes to theme"
                            title="Save changes to theme"
                          >
                            <CheckIcon width={16} height={16} />
                          </button>
                          <button
                            type="button"
                            className="theme-action-button"
                            onClick={handleCancelActiveTheme}
                            aria-label="Cancel"
                            title="Cancel — revert to saved theme"
                          >
                            <CloseIcon width={14} height={14} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="theme-action-button"
                            onClick={() => handleEnterEditMode(theme)}
                            aria-label="Edit theme"
                            title="Edit theme"
                          >
                            <EditIcon width={16} height={16} />
                          </button>
                          {isDefault ? (
                            <span className="theme-action-spacer"></span>
                          ) : (
                            <button
                              type="button"
                              className="theme-action-button theme-action-delete"
                              onClick={() => setDeleteConfirmThemeId(theme.id)}
                              aria-label="Delete theme"
                              title="Delete theme"
                            >
                              <DeleteIcon width={16} height={16} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
                {editingThemeId === 'new' ? (
                  <div className="themes-table-row themes-table-row--new">
                    <span className="themes-drag-handle themes-drag-handle--placeholder"></span>
                    <div className="theme-fields">
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
                    </div>
                    <button
                      type="button"
                      className="theme-action-button"
                      onClick={handleThemeSave}
                      aria-label="Save new theme"
                      title="Save new theme"
                    >
                      <CheckIcon width={16} height={16} />
                    </button>
                    <button
                      type="button"
                      className="theme-action-button"
                      onClick={handleThemeEditCancel}
                      aria-label="Cancel"
                      title="Cancel"
                    >
                      <CloseIcon width={14} height={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="themes-save-new-row"
                    onClick={handleSaveCurrentAsTheme}
                  >
                    + Save new theme
                  </button>
                )}
              </div>
            )}
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
    </div>
  );
}

export default AppearanceSection;

/**
 * frontend/src/ui/settings/sections/AppearanceSection.tsx
 *
 * Appearance tab content: Mode (System/Light/Dark) + Theme (tint sliders,
 * accent, link, saved themes).
 */

import {
  AppearanceModeIcon,
  DarkModeIcon,
  LightModeIcon,
} from '@shared/components/icons/SettingsIcons';
import {
  CheckIcon,
  CloseIcon,
  DeleteIcon,
  EditIcon,
  PlusIcon,
} from '@shared/components/icons/SharedIcons';
import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import { applyAccentBg, applyAccentColor } from '@utils/accentColor';
import { errorHandler } from '@utils/errorHandler';
import { applyLinkColor } from '@utils/linkColor';
import {
  applyTintedPalette,
  isPaletteActive,
  MAX_BRIGHTNESS_OFFSET,
  MAX_SATURATION,
} from '@utils/paletteTint';
import { types } from '@wailsjs/go/models';
import {
  type CSSProperties,
  type ReactElement,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAppearanceMode } from '@/core/contexts/AppearanceModeContext';
import {
  type AppearanceMode,
  createAccentColorPreferenceWorkflow,
  createLinkColorPreferenceWorkflow,
  createPaletteTintPreferenceWorkflow,
  getAccentColor,
  getIntegerPreferenceMetadata,
  getLinkColor,
  getPaletteTint,
  getPreferenceMetadata,
  hydrateAppPreferences,
  normalizeIntegerPreferenceValue,
} from '@/core/settings/appPreferences';
import { changeAppearanceMode } from '@/utils/appearanceMode';
import { useThemes } from './useThemes';

const DEFAULT_THEME_ID = 'default';

export function reorderThemeByOffset(
  ids: string[],
  themeId: string,
  offset: -1 | 1
): string[] | null {
  const fromIndex = ids.indexOf(themeId);
  const defaultIndex = ids.indexOf(DEFAULT_THEME_ID);
  const lastCustomIndex = defaultIndex === -1 ? ids.length - 1 : defaultIndex - 1;
  const toIndex = fromIndex + offset;
  if (themeId === DEFAULT_THEME_ID || fromIndex < 0 || toIndex < 0 || toIndex > lastCustomIndex) {
    return null;
  }
  const reordered = [...ids];
  reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, themeId);
  return reordered;
}

const isDefaultTheme = (theme: types.Theme) => theme.id === DEFAULT_THEME_ID;

type PaletteSliderStyle = CSSProperties & {
  '--palette-slider-thumb'?: string;
};

const appearanceModeOptions = [
  { value: 'system', label: 'System', icon: AppearanceModeIcon },
  { value: 'light', label: 'Light', icon: LightModeIcon },
  { value: 'dark', label: 'Dark', icon: DarkModeIcon },
] as const;

const buildPaletteSliderStyle = (thumbColor: string, background?: string): PaletteSliderStyle => ({
  '--palette-slider-thumb': thumbColor,
  ...(background ? { background } : {}),
});

function AppearanceModeSelector({
  mode,
  options,
  onChange,
}: {
  mode: AppearanceMode;
  options: ReadonlyArray<(typeof appearanceModeOptions)[number]>;
  onChange: (mode: AppearanceMode) => void;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-label">
        <div className="settings-row-label-title">Mode</div>
        <div className="settings-row-label-help">
          Follow the system mode or choose light/dark mode.
        </div>
      </div>
      <div className="settings-row-control">
        <fieldset className="settings-choice-buttons" aria-label="Appearance mode">
          {options.map((option) => {
            const Icon = option.icon;
            const isSelected = mode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                className={`settings-choice-button${isSelected ? ' settings-choice-button--active' : ''}`}
                aria-pressed={isSelected}
                onClick={() => onChange(option.value)}
              >
                <Icon width={18} height={18} />
                <span>{option.label}</span>
              </button>
            );
          })}
        </fieldset>
      </div>
    </div>
  );
}

function PaletteControls({
  paletteHue,
  paletteSaturation,
  paletteBrightness,
  hueSliderStyle,
  saturationSliderStyle,
  brightnessSliderStyle,
  paletteBounds,
  renderEditableValue,
  onHueChange,
  onSaturationChange,
  onBrightnessChange,
  onHueReset,
  onSaturationReset,
  onBrightnessReset,
}: {
  paletteHue: number;
  paletteSaturation: number;
  paletteBrightness: number;
  hueSliderStyle: PaletteSliderStyle;
  saturationSliderStyle: PaletteSliderStyle;
  brightnessSliderStyle: PaletteSliderStyle;
  paletteBounds: {
    hue: { min: number; max?: number };
    saturation: { min: number; max?: number };
    brightness: { min: number; max?: number };
  };
  renderEditableValue: (
    field: 'hue' | 'saturation' | 'brightness',
    value: number,
    suffix: string
  ) => ReactElement;
  onHueChange: (value: number) => void;
  onSaturationChange: (value: number) => void;
  onBrightnessChange: (value: number) => void;
  onHueReset: () => void;
  onSaturationReset: () => void;
  onBrightnessReset: () => void;
}) {
  const elementIdPrefix = useId();

  return (
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
          <label htmlFor={`${elementIdPrefix}-palette-hue`}>Hue</label>
          <input
            type="range"
            id={`${elementIdPrefix}-palette-hue`}
            className="palette-slider palette-slider-hue"
            min={paletteBounds.hue.min}
            max={paletteBounds.hue.max}
            value={paletteHue}
            onChange={(e) => onHueChange(Number(e.target.value))}
            style={hueSliderStyle}
          />
          {renderEditableValue('hue', paletteHue, '°')}
          <button
            type="button"
            className="palette-row-reset"
            onClick={onHueReset}
            disabled={paletteHue === 0}
            title="Reset Hue"
          >
            ↺
          </button>

          <label htmlFor={`${elementIdPrefix}-palette-saturation`}>Saturation</label>
          <input
            type="range"
            id={`${elementIdPrefix}-palette-saturation`}
            className="palette-slider palette-slider-saturation"
            min={paletteBounds.saturation.min}
            max={paletteBounds.saturation.max}
            value={paletteSaturation}
            onChange={(e) => onSaturationChange(Number(e.target.value))}
            style={saturationSliderStyle}
          />
          {renderEditableValue('saturation', paletteSaturation, '%')}
          <button
            type="button"
            className="palette-row-reset"
            onClick={onSaturationReset}
            disabled={paletteSaturation === 0}
            title="Reset Saturation"
          >
            ↺
          </button>

          <label htmlFor={`${elementIdPrefix}-palette-brightness`}>Brightness</label>
          <input
            type="range"
            id={`${elementIdPrefix}-palette-brightness`}
            className="palette-slider palette-slider-brightness"
            min={paletteBounds.brightness.min}
            max={paletteBounds.brightness.max}
            value={paletteBrightness}
            onChange={(e) => onBrightnessChange(Number(e.target.value))}
            style={brightnessSliderStyle}
          />
          {renderEditableValue('brightness', paletteBrightness, '')}
          <button
            type="button"
            className="palette-row-reset"
            onClick={onBrightnessReset}
            disabled={paletteBrightness === 0}
            title="Reset Brightness"
          >
            ↺
          </button>
        </div>
      </div>
    </div>
  );
}

function ColorControl({
  title,
  help,
  value,
  defaultColor,
  isEditing,
  inputRef,
  draft,
  onDraftChange,
  onChange,
  onHexClick,
  onHexCommit,
  onHexCancel,
  onReset,
}: {
  title: string;
  help: string;
  value: string;
  defaultColor: string;
  isEditing: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  draft: string;
  onDraftChange: (value: string) => void;
  onChange: (value: string) => void;
  onHexClick: () => void;
  onHexCommit: () => void;
  onHexCancel: () => void;
  onReset: () => void;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-label">
        <div className="settings-row-label-title">{title}</div>
        <div className="settings-row-label-help">{help}</div>
      </div>
      <div className="settings-row-control">
        <div className="palette-color-field">
          <input
            type="color"
            className="palette-accent-swatch"
            value={value || defaultColor}
            onChange={(e) => onChange(e.target.value)}
          />
          {isEditing ? (
            <input
              ref={inputRef}
              className="color-swatch-value palette-hex-input"
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onHexCommit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  onHexCancel();
                } else {
                  e.stopPropagation();
                }
              }}
              onBlur={onHexCancel}
              maxLength={7}
            />
          ) : (
            <button
              type="button"
              className="color-swatch-value palette-hex-clickable"
              onClick={onHexClick}
              title="Click to edit hex value"
            >
              {value || defaultColor}
            </button>
          )}
          <button
            type="button"
            className="palette-row-reset"
            onClick={onReset}
            disabled={!value}
            title={`Reset ${title}`}
          >
            ↺
          </button>
        </div>
      </div>
    </div>
  );
}

function AppearanceSection() {
  const elementIdPrefix = useId();
  const { mode, resolvedMode } = useAppearanceMode();

  // Palette tint state for hue/saturation/brightness sliders.
  const [paletteHue, setPaletteHue] = useState(0);
  const [paletteSaturation, setPaletteSaturation] = useState(0);
  const [paletteBrightness, setPaletteBrightness] = useState(0);
  const palettePreferenceWorkflow = useMemo(() => createPaletteTintPreferenceWorkflow(), []);

  // Accent color state.
  const [accentColor, setAccentColorState] = useState('');
  const accentColorPreferenceWorkflow = useMemo(() => createAccentColorPreferenceWorkflow(), []);
  const [isEditingAccentHex, setIsEditingAccentHex] = useState(false);
  const [accentHexDraft, setAccentHexDraft] = useState('');
  const accentHexInputRef = useRef<HTMLInputElement>(null);

  // Link color state.
  const [linkColor, setLinkColorState] = useState('');
  const linkColorPreferenceWorkflow = useMemo(() => createLinkColorPreferenceWorkflow(), []);
  const [isEditingLinkHex, setIsEditingLinkHex] = useState(false);
  const [linkHexDraft, setLinkHexDraft] = useState('');
  const linkHexInputRef = useRef<HTMLInputElement>(null);

  // Inline editing for palette slider values.
  const [editingPaletteField, setEditingPaletteField] = useState<
    'hue' | 'saturation' | 'brightness' | null
  >(null);
  const [paletteDraft, setPaletteDraft] = useState('');
  const paletteInputRef = useRef<HTMLInputElement>(null);

  const {
    themes,
    themesLoading,
    validateThemePattern,
    saveThemeEntry,
    deleteThemeEntry,
    reorderThemeEntries,
    applyThemeEntry,
  } = useThemes();
  const [activeThemeId, setActiveThemeId] = useState<string | null>(null);
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null);
  const [themeDraft, setThemeDraft] = useState({ name: '', clusterPattern: '' });
  const [draggingThemeId, setDraggingThemeId] = useState<string | null>(null);
  const [dropTargetThemeId, setDropTargetThemeId] = useState<string | null>(null);
  const [deleteConfirmThemeId, setDeleteConfirmThemeId] = useState<string | null>(null);
  const [hasUnsavedDefaultThemeChanges, setHasUnsavedDefaultThemeChanges] = useState(false);
  const [themePatternError, setThemePatternError] = useState<string | null>(null);
  const newThemeNameInputRef = useRef<HTMLInputElement>(null);
  const appearanceModeMetadata = getPreferenceMetadata('appearanceMode');
  const enabledAppearanceModeOptions = appearanceModeOptions.filter(
    (option) =>
      !appearanceModeMetadata.enumOptions ||
      appearanceModeMetadata.enumOptions.includes(option.value)
  );
  const palettePreferenceKeys =
    resolvedMode === 'light'
      ? {
          hue: 'paletteHueLight' as const,
          saturation: 'paletteSaturationLight' as const,
          brightness: 'paletteBrightnessLight' as const,
        }
      : {
          hue: 'paletteHueDark' as const,
          saturation: 'paletteSaturationDark' as const,
          brightness: 'paletteBrightnessDark' as const,
        };
  const paletteBounds = {
    hue: getIntegerPreferenceMetadata(palettePreferenceKeys.hue),
    saturation: getIntegerPreferenceMetadata(palettePreferenceKeys.saturation),
    brightness: getIntegerPreferenceMetadata(palettePreferenceKeys.brightness),
  };

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

  useEffect(() => {
    if (editingThemeId === 'new') {
      newThemeNameInputRef.current?.focus();
    }
  }, [editingThemeId]);

  // Clean up pending preference commits on unmount.
  useEffect(() => {
    return () => {
      palettePreferenceWorkflow.cancelPending();
      accentColorPreferenceWorkflow.cancelPending();
      linkColorPreferenceWorkflow.cancelPending();
    };
  }, [accentColorPreferenceWorkflow, linkColorPreferenceWorkflow, palettePreferenceWorkflow]);

  const handleAppearanceModeChange = async (nextMode: AppearanceMode) => {
    try {
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
      palettePreferenceWorkflow.commitDebounced({
        mode: resolvedMode,
        hue,
        saturation,
        brightness,
      });
    },
    [palettePreferenceWorkflow, resolvedMode]
  );

  const handlePaletteHueChange = (value: number) => {
    const normalized = normalizeIntegerPreferenceValue(palettePreferenceKeys.hue, value);
    flagUnsavedDefaultThemeChange();
    setPaletteHue(normalized);
    applyTintedPalette(normalized, paletteSaturation, paletteBrightness);
    debouncePalettePersist(normalized, paletteSaturation, paletteBrightness);
  };

  const handlePaletteSaturationChange = (value: number) => {
    const normalized = normalizeIntegerPreferenceValue(palettePreferenceKeys.saturation, value);
    flagUnsavedDefaultThemeChange();
    setPaletteSaturation(normalized);
    applyTintedPalette(paletteHue, normalized, paletteBrightness);
    debouncePalettePersist(paletteHue, normalized, paletteBrightness);
  };

  const handlePaletteBrightnessChange = (value: number) => {
    const normalized = normalizeIntegerPreferenceValue(palettePreferenceKeys.brightness, value);
    flagUnsavedDefaultThemeChange();
    setPaletteBrightness(normalized);
    applyTintedPalette(paletteHue, paletteSaturation, normalized);
    debouncePalettePersist(paletteHue, paletteSaturation, normalized);
  };

  const handleHueReset = () => {
    const defaultValue = Number(getPreferenceMetadata(palettePreferenceKeys.hue).defaultValue);
    flagUnsavedDefaultThemeChange();
    setPaletteHue(defaultValue);
    applyTintedPalette(defaultValue, paletteSaturation, paletteBrightness);
    debouncePalettePersist(defaultValue, paletteSaturation, paletteBrightness);
  };

  const handleSaturationReset = () => {
    const defaultValue = Number(
      getPreferenceMetadata(palettePreferenceKeys.saturation).defaultValue
    );
    flagUnsavedDefaultThemeChange();
    setPaletteSaturation(defaultValue);
    applyTintedPalette(paletteHue, defaultValue, paletteBrightness);
    debouncePalettePersist(paletteHue, defaultValue, paletteBrightness);
  };

  const handleBrightnessReset = () => {
    const defaultValue = Number(
      getPreferenceMetadata(palettePreferenceKeys.brightness).defaultValue
    );
    flagUnsavedDefaultThemeChange();
    setPaletteBrightness(defaultValue);
    applyTintedPalette(paletteHue, paletteSaturation, defaultValue);
    debouncePalettePersist(paletteHue, paletteSaturation, defaultValue);
  };

  const debounceAccentPersist = useCallback(
    (color: string) => {
      accentColorPreferenceWorkflow.commitDebounced({ mode: resolvedMode, color });
    },
    [accentColorPreferenceWorkflow, resolvedMode]
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
    setAccentColorState('');
    applyAccentColor(
      resolvedMode === 'light' ? '' : getAccentColor('light'),
      resolvedMode === 'dark' ? '' : getAccentColor('dark')
    );
    applyAccentBg('', resolvedMode);
    accentColorPreferenceWorkflow.commit({ mode: resolvedMode, color: '' });
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
    if (!trimmed.startsWith('#')) {
      trimmed = `#${trimmed}`;
    }
    if (/^#[0-9a-f]{3}$/.test(trimmed)) {
      trimmed = `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
    }
    if (validHexRe.test(trimmed)) {
      handleAccentColorChange(trimmed);
    }
    setIsEditingAccentHex(false);
  };

  const handleAccentHexCancel = () => setIsEditingAccentHex(false);

  const debounceLinkPersist = useCallback(
    (color: string) => {
      linkColorPreferenceWorkflow.commitDebounced({ mode: resolvedMode, color });
    },
    [linkColorPreferenceWorkflow, resolvedMode]
  );

  const handleLinkColorChange = (hex: string) => {
    flagUnsavedDefaultThemeChange();
    setLinkColorState(hex);
    applyLinkColor(hex, resolvedMode);
    debounceLinkPersist(hex);
  };

  const handleLinkReset = () => {
    flagUnsavedDefaultThemeChange();
    setLinkColorState('');
    applyLinkColor('', resolvedMode);
    linkColorPreferenceWorkflow.commit({ mode: resolvedMode, color: '' });
  };

  const defaultLink = resolvedMode === 'light' ? '#525252' : '#aaaaaa';

  const handleLinkHexClick = () => {
    setLinkHexDraft(linkColor || defaultLink);
    setIsEditingLinkHex(true);
    requestAnimationFrame(() => linkHexInputRef.current?.select());
  };

  const handleLinkHexCommit = () => {
    let trimmed = linkHexDraft.trim().toLowerCase();
    if (!trimmed.startsWith('#')) {
      trimmed = `#${trimmed}`;
    }
    if (/^#[0-9a-f]{3}$/.test(trimmed)) {
      trimmed = `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
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
    if (!editingPaletteField) {
      return;
    }
    const parsed = parseInt(paletteDraft, 10);
    if (Number.isNaN(parsed)) {
      setEditingPaletteField(null);
      return;
    }
    if (editingPaletteField === 'hue') {
      handlePaletteHueChange(parsed);
    } else if (editingPaletteField === 'saturation') {
      handlePaletteSaturationChange(parsed);
    } else if (editingPaletteField === 'brightness') {
      handlePaletteBrightnessChange(parsed);
    }
    setEditingPaletteField(null);
  };

  const handlePaletteValueCancel = () => setEditingPaletteField(null);

  const validateThemePatternDraft = async (pattern: string): Promise<boolean> => {
    setThemePatternError(null);
    const result = await validateThemePattern(pattern);
    if (!result.valid) {
      setThemePatternError(result.message || 'Invalid cluster pattern.');
      return false;
    }
    return true;
  };

  const handleSaveCurrentAsTheme = () => {
    setThemePatternError(null);
    setEditingThemeId('new');
    setThemeDraft({ name: '', clusterPattern: '' });
  };

  // Enter edit mode for an existing theme: applies the theme to the live UI
  // (so palette sliders/colors reflect it) and seeds the row inputs with the
  // theme's current name and pattern. Save / Cancel icons drive commit/revert.
  const handleEnterEditMode = (theme: types.Theme) => {
    setThemePatternError(null);
    setThemeDraft({ name: theme.name, clusterPattern: theme.clusterPattern });
    if (isDefaultTheme(theme) && hasUnsavedDefaultThemeChanges) {
      setActiveThemeId(theme.id);
      return;
    }
    handleApplyTheme(theme.id);
  };

  // Commit the active theme's edits (palette + name/pattern from themeDraft).
  const handleSaveActiveTheme = async () => {
    if (!activeThemeId) {
      return;
    }
    const existing = themes.find((t) => t.id === activeThemeId);
    if (!existing) {
      return;
    }
    const trimmedName = themeDraft.name.trim();
    if (!trimmedName) {
      return; // Name is required.
    }
    const isDefault = existing.id === DEFAULT_THEME_ID;
    const clusterPattern = isDefault ? '' : themeDraft.clusterPattern.trim();

    if (!isDefault && !(await validateThemePatternDraft(clusterPattern))) {
      return;
    }

    try {
      const updated = buildThemeFromCurrentAppearance({
        theme: existing,
        name: isDefault ? existing.name : trimmedName,
        clusterPattern,
      });
      await saveThemeEntry(updated);
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
    if (!activeThemeId) {
      return;
    }
    await handleApplyTheme(activeThemeId);
    setThemePatternError(null);
    setActiveThemeId(null);
    if (activeThemeId === DEFAULT_THEME_ID) {
      setHasUnsavedDefaultThemeChanges(false);
    }
  };

  const handleThemeSave = async () => {
    if (!themeDraft.name.trim()) {
      return;
    }
    const clusterPattern = themeDraft.clusterPattern.trim();

    if (!(await validateThemePatternDraft(clusterPattern))) {
      return;
    }

    try {
      const newTheme = buildThemeFromCurrentAppearance({
        theme: new types.Theme({
          id: crypto.randomUUID(),
          name: themeDraft.name.trim(),
          clusterPattern,
        }),
      });
      await saveThemeEntry(newTheme);
      setEditingThemeId(null);
    } catch (error) {
      errorHandler.handle(error, { action: 'saveTheme' });
    }
  };

  const handleThemeEditCancel = () => {
    setThemePatternError(null);
    setEditingThemeId(null);
  };

  const handleDeleteThemeConfirm = async () => {
    if (!deleteConfirmThemeId) {
      return;
    }
    try {
      await deleteThemeEntry(deleteConfirmThemeId);
    } catch (error) {
      errorHandler.handle(error, { action: 'deleteTheme' });
    } finally {
      setDeleteConfirmThemeId(null);
    }
  };

  const handleApplyTheme = async (id: string) => {
    try {
      await applyThemeEntry(id);
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

      const lightAccent = getAccentColor('light');
      const darkAccent = getAccentColor('dark');
      applyAccentColor(lightAccent, darkAccent);
      applyAccentBg(currentMode === 'light' ? lightAccent : darkAccent, currentMode);

      const currentLinkColor = getLinkColor(currentMode);
      applyLinkColor(currentLinkColor, currentMode);

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
    if (!defaultTheme) {
      return;
    }
    try {
      await saveThemeEntry(
        buildThemeFromCurrentAppearance({
          theme: defaultTheme,
          name: defaultTheme.name,
          clusterPattern: '',
        })
      );
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
    if (fromIdx === -1 || toIdx === -1) {
      return;
    }

    const reordered = [...ids];
    reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, draggingThemeId);

    try {
      await reorderThemeEntries(reordered);
    } catch (error) {
      errorHandler.handle(error, { action: 'reorderThemes' });
    } finally {
      setDraggingThemeId(null);
      setDropTargetThemeId(null);
    }
  };

  const handleThemeKeyboardReorder = async (themeId: string, offset: -1 | 1) => {
    const reordered = reorderThemeByOffset(
      themes.map((theme) => theme.id),
      themeId,
      offset
    );
    if (!reordered) {
      return;
    }
    try {
      await reorderThemeEntries(reordered);
    } catch (error) {
      errorHandler.handle(error, { action: 'reorderThemes' });
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
      <button
        type="button"
        className="palette-slider-value palette-hex-clickable"
        onClick={() => handlePaletteValueClick(field)}
        title="Click to edit value"
      >
        {value > 0 && field === 'brightness' ? '+' : ''}
        {value}
        {suffix}
      </button>
    );
  };

  return (
    <div className="settings-panel">
      <h2 className="settings-panel-title">Appearance</h2>

      <div className="settings-subgroup-label">Mode</div>
      <hr className="settings-subgroup-divider" />

      <AppearanceModeSelector
        mode={mode}
        options={enabledAppearanceModeOptions}
        onChange={handleAppearanceModeChange}
      />

      <div className="settings-subgroup-label">Theme</div>
      <hr className="settings-subgroup-divider" />

      <div className="settings-subgroup-description">
        Each theme stores data for both light and dark modes. The default theme can be modified but
        cannot be deleted. Use pattern matching to automatically apply themes based on the cluster
        name -- for example, a red theme for prod clusters, blue for dev, etc.
      </div>

      <PaletteControls
        paletteHue={paletteHue}
        paletteSaturation={paletteSaturation}
        paletteBrightness={paletteBrightness}
        hueSliderStyle={hueSliderStyle}
        saturationSliderStyle={saturationSliderStyle}
        brightnessSliderStyle={brightnessSliderStyle}
        paletteBounds={paletteBounds}
        renderEditableValue={renderEditableValue}
        onHueChange={handlePaletteHueChange}
        onSaturationChange={handlePaletteSaturationChange}
        onBrightnessChange={handlePaletteBrightnessChange}
        onHueReset={handleHueReset}
        onSaturationReset={handleSaturationReset}
        onBrightnessReset={handleBrightnessReset}
      />

      <ColorControl
        title="Accent color"
        help="Used for active states, focus, and other elements that require emphasis."
        value={accentColor}
        defaultColor={defaultAccent}
        isEditing={isEditingAccentHex}
        inputRef={accentHexInputRef}
        draft={accentHexDraft}
        onDraftChange={setAccentHexDraft}
        onChange={handleAccentColorChange}
        onHexClick={handleAccentHexClick}
        onHexCommit={handleAccentHexCommit}
        onHexCancel={handleAccentHexCancel}
        onReset={handleAccentReset}
      />

      <ColorControl
        title="Link color"
        help="Color of inline links in throughout the app."
        value={linkColor}
        defaultColor={defaultLink}
        isEditing={isEditingLinkHex}
        inputRef={linkHexInputRef}
        draft={linkHexDraft}
        onDraftChange={setLinkHexDraft}
        onChange={handleLinkColorChange}
        onHexClick={handleLinkHexClick}
        onHexCommit={handleLinkHexCommit}
        onHexCancel={handleLinkHexCancel}
        onReset={handleLinkReset}
      />

      <div className="settings-row">
        <div className="settings-row-label">
          <div className="settings-row-label-title">Saved themes</div>
          <div className="settings-row-label-help">
            {}
            Themes can be automatically applied to clusters whose name matches the pattern.
            <ul className="themes-help-list">
              <li>
                Patterns support wildcards and ranges such as <code>*</code>, <code>?</code>, and{' '}
                <code>[a-z]</code>
              </li>
              <li>Themes are applied based on first match.</li>
              <li>Use the drag handles to change order.</li>
              <li>Default theme always resolves last, and matches any cluster name.</li>
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
                      <span>There are unsaved changes. Save as default?</span>
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
                      className={`setting-item setting-item-surface themes-table-row${isDragging ? ' themes-table-row--dragging' : ''}${isDropTarget ? ' themes-table-row--drop-target' : ''}${activeThemeId && activeThemeId !== theme.id ? ' themes-table-row--dimmed' : ''}`}
                    >
                      {isDefault ? (
                        <span className="themes-drag-handle themes-drag-handle--placeholder"></span>
                      ) : (
                        <button
                          type="button"
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
                          onDragOver={(event) => {
                            if (!draggingThemeId) {
                              return;
                            }
                            event.preventDefault();
                            setDropTargetThemeId(theme.id);
                          }}
                          onDragLeave={() => {
                            setDropTargetThemeId((current) =>
                              current === theme.id ? null : current
                            );
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            void handleThemeDrop(theme.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
                              return;
                            }
                            event.preventDefault();
                            void handleThemeKeyboardReorder(
                              theme.id,
                              event.key === 'ArrowUp' ? -1 : 1
                            );
                          }}
                          aria-label={`Reorder ${theme.name}. Use Up and Down Arrow keys.`}
                          title="Drag or use Up and Down Arrow keys to reorder"
                        >
                          &#x283F;
                        </button>
                      )}
                      {activeThemeId === theme.id && !isDefault ? (
                        <div className="theme-fields">
                          <input
                            className="theme-name-input"
                            value={themeDraft.name}
                            onChange={(e) => setThemeDraft((d) => ({ ...d, name: e.target.value }))}
                            placeholder="Name"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleSaveActiveTheme();
                              } else if (e.key === 'Escape') {
                                handleCancelActiveTheme();
                              } else {
                                e.stopPropagation();
                              }
                            }}
                          />
                          <input
                            className="theme-pattern-input"
                            value={themeDraft.clusterPattern}
                            onChange={(e) => {
                              setThemePatternError(null);
                              setThemeDraft((d) => ({
                                ...d,
                                clusterPattern: e.target.value,
                              }));
                            }}
                            placeholder="Pattern (optional)"
                            aria-invalid={themePatternError ? 'true' : undefined}
                            aria-describedby={
                              themePatternError ? 'theme-pattern-error-active' : undefined
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleSaveActiveTheme();
                              } else if (e.key === 'Escape') {
                                handleCancelActiveTheme();
                              } else {
                                e.stopPropagation();
                              }
                            }}
                          />
                          {!!themePatternError && (
                            <div
                              id={`${elementIdPrefix}-theme-pattern-error-active`}
                              className="theme-pattern-error"
                            >
                              {themePatternError}
                            </div>
                          )}
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
                  <div className="setting-item setting-item-surface themes-table-row themes-table-row--new">
                    <span className="themes-drag-handle themes-drag-handle--placeholder"></span>
                    <div className="theme-fields">
                      <input
                        ref={newThemeNameInputRef}
                        className="theme-name-input"
                        value={themeDraft.name}
                        onChange={(e) => setThemeDraft((d) => ({ ...d, name: e.target.value }))}
                        placeholder="Name"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleThemeSave();
                          } else if (e.key === 'Escape') {
                            handleThemeEditCancel();
                          } else {
                            e.stopPropagation();
                          }
                        }}
                      />
                      <input
                        className="theme-pattern-input"
                        value={themeDraft.clusterPattern}
                        onChange={(e) => {
                          setThemePatternError(null);
                          setThemeDraft((d) => ({
                            ...d,
                            clusterPattern: e.target.value,
                          }));
                        }}
                        placeholder="Pattern (optional)"
                        aria-invalid={themePatternError ? 'true' : undefined}
                        aria-describedby={themePatternError ? 'theme-pattern-error-new' : undefined}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleThemeSave();
                          } else if (e.key === 'Escape') {
                            handleThemeEditCancel();
                          } else {
                            e.stopPropagation();
                          }
                        }}
                      />
                      {!!themePatternError && (
                        <div
                          id={`${elementIdPrefix}-theme-pattern-error-new`}
                          className="theme-pattern-error"
                        >
                          {themePatternError}
                        </div>
                      )}
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
                    className="button generic settings-add-button themes-save-new-row"
                    onClick={handleSaveCurrentAsTheme}
                  >
                    <PlusIcon width={12} height={12} />
                    Save new theme
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

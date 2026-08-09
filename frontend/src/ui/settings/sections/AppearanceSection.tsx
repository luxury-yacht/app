/**
 * frontend/src/ui/settings/sections/AppearanceSection.tsx
 *
 * Appearance tab content: Mode (System/Light/Dark) + Theme (tint sliders,
 * accent, link, saved themes).
 */

import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
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
  type Dispatch,
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  type SetStateAction,
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

interface ThemeAppearanceValues {
  hue: number;
  saturation: number;
  brightness: number;
  accent: string;
  link: string;
}

const getThemeAppearanceValues = (
  theme: types.Theme,
  appearance: 'light' | 'dark'
): ThemeAppearanceValues => {
  if (appearance === 'light') {
    return {
      hue: theme.paletteHueLight,
      saturation: theme.paletteSaturationLight,
      brightness: theme.paletteBrightnessLight,
      accent: theme.accentColorLight || '',
      link: theme.linkColorLight || '',
    };
  }
  return {
    hue: theme.paletteHueDark,
    saturation: theme.paletteSaturationDark,
    brightness: theme.paletteBrightnessDark,
    accent: theme.accentColorDark || '',
    link: theme.linkColorDark || '',
  };
};

const getCurrentAppearanceValues = (
  appearance: 'light' | 'dark',
  activeAppearance: 'light' | 'dark',
  activeValues: ThemeAppearanceValues
): ThemeAppearanceValues => {
  if (appearance === activeAppearance) {
    return activeValues;
  }
  const tint = getPaletteTint(appearance);
  return {
    hue: tint.hue,
    saturation: tint.saturation,
    brightness: tint.brightness,
    accent: getAccentColor(appearance) || '',
    link: getLinkColor(appearance) || '',
  };
};

const appearanceValuesEqual = (left: ThemeAppearanceValues, right: ThemeAppearanceValues) =>
  left.hue === right.hue &&
  left.saturation === right.saturation &&
  left.brightness === right.brightness &&
  left.accent === right.accent &&
  left.link === right.link;

const doesThemeMatchCurrentAppearance = (
  theme: types.Theme,
  resolvedMode: 'light' | 'dark',
  activeValues: ThemeAppearanceValues
) =>
  appearanceValuesEqual(
    getThemeAppearanceValues(theme, 'light'),
    getCurrentAppearanceValues('light', resolvedMode, activeValues)
  ) &&
  appearanceValuesEqual(
    getThemeAppearanceValues(theme, 'dark'),
    getCurrentAppearanceValues('dark', resolvedMode, activeValues)
  );

const buildThemeWithCurrentAppearance = ({
  theme,
  name,
  clusterPattern,
  resolvedMode,
  activeValues,
}: {
  theme: types.Theme;
  name: string;
  clusterPattern: string;
  resolvedMode: 'light' | 'dark';
  activeValues: ThemeAppearanceValues;
}) => {
  const light = getCurrentAppearanceValues('light', resolvedMode, activeValues);
  const dark = getCurrentAppearanceValues('dark', resolvedMode, activeValues);
  return new types.Theme({
    ...theme,
    name,
    clusterPattern,
    paletteHueLight: light.hue,
    paletteSaturationLight: light.saturation,
    paletteBrightnessLight: light.brightness,
    paletteHueDark: dark.hue,
    paletteSaturationDark: dark.saturation,
    paletteBrightnessDark: dark.brightness,
    accentColorLight: light.accent,
    accentColorDark: dark.accent,
    linkColorLight: light.link,
    linkColorDark: dark.link,
  });
};

interface ThemeSavePlan {
  existing: types.Theme;
  isDefault: boolean;
  name: string;
  clusterPattern: string;
}

const getThemeSavePlan = (
  activeThemeId: string | null,
  themes: types.Theme[],
  draft: { name: string; clusterPattern: string }
): ThemeSavePlan | null => {
  if (!activeThemeId) {
    return null;
  }
  const existing = themes.find((theme) => theme.id === activeThemeId);
  const name = draft.name.trim();
  if (!existing || !name) {
    return null;
  }
  const isDefault = existing.id === DEFAULT_THEME_ID;
  return {
    existing,
    isDefault,
    name: isDefault ? existing.name : name,
    clusterPattern: isDefault ? '' : draft.clusterPattern.trim(),
  };
};

function AppearanceModeSelector({
  mode,
  options,
  onChange,
}: Readonly<{
  mode: AppearanceMode;
  options: ReadonlyArray<(typeof appearanceModeOptions)[number]>;
  onChange: (mode: AppearanceMode) => void;
}>) {
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
}: Readonly<{
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
}>) {
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
}: Readonly<{
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
}>) {
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

type ThemeDraft = { name: string; clusterPattern: string };

const handleThemeEditorKeyDown = (
  event: ReactKeyboardEvent<HTMLInputElement>,
  onSave: () => void,
  onCancel: () => void
) => {
  if (event.key === 'Enter') {
    onSave();
    return;
  }
  if (event.key === 'Escape') {
    onCancel();
    return;
  }
  event.stopPropagation();
};

const buildThemeRowClassName = (
  themeId: string,
  activeThemeId: string | null,
  draggingThemeId: string | null,
  dropTargetThemeId: string | null,
  isDefault: boolean
) =>
  [
    'setting-item setting-item-surface themes-table-row',
    themeId === draggingThemeId && 'themes-table-row--dragging',
    themeId === dropTargetThemeId &&
      themeId !== draggingThemeId &&
      !isDefault &&
      'themes-table-row--drop-target',
    activeThemeId && activeThemeId !== themeId && 'themes-table-row--dimmed',
  ]
    .filter(Boolean)
    .join(' ');

interface ThemeRowSharedProps {
  elementIdPrefix: string;
  theme: types.Theme;
  isDefault: boolean;
  activeThemeId: string | null;
  themeDraft: ThemeDraft;
  themePatternError: string | null;
  setThemeDraft: Dispatch<SetStateAction<ThemeDraft>>;
  setThemePatternError: (value: string | null) => void;
  onSave: () => void;
  onCancel: () => void;
}

interface ThemeDragHandleProps {
  theme: types.Theme;
  isDefault: boolean;
  draggingThemeId: string | null;
  setDraggingThemeId: (id: string | null) => void;
  setDropTargetThemeId: Dispatch<SetStateAction<string | null>>;
  onDrop: (themeId: string) => void;
  onKeyboardReorder: (themeId: string, offset: -1 | 1) => void;
}

const ThemeDragHandle = ({
  theme,
  isDefault,
  draggingThemeId,
  setDraggingThemeId,
  setDropTargetThemeId,
  onDrop,
  onKeyboardReorder,
}: ThemeDragHandleProps) => {
  if (isDefault) {
    return <span className="themes-drag-handle themes-drag-handle--placeholder" />;
  }
  return (
    <button
      type="button"
      className="themes-drag-handle"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
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
        setDropTargetThemeId((current) => (current === theme.id ? null : current));
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(theme.id);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
          return;
        }
        event.preventDefault();
        onKeyboardReorder(theme.id, event.key === 'ArrowUp' ? -1 : 1);
      }}
      aria-label={`Reorder ${theme.name}. Use Up and Down Arrow keys.`}
      title="Drag or use Up and Down Arrow keys to reorder"
    >
      &#x283F;
    </button>
  );
};

const ThemeRowFields = (props: ThemeRowSharedProps) => {
  if (props.activeThemeId !== props.theme.id || props.isDefault) {
    return (
      <div className="theme-summary">
        <span className="theme-name">{props.theme.name}</span>
        <span className="theme-pattern">{props.theme.clusterPattern || '*'}</span>
      </div>
    );
  }
  return (
    <div className="theme-fields">
      <input
        className="theme-name-input"
        value={props.themeDraft.name}
        onChange={(event) =>
          props.setThemeDraft((draft) => ({ ...draft, name: event.target.value }))
        }
        placeholder="Name"
        onKeyDown={(event) => handleThemeEditorKeyDown(event, props.onSave, props.onCancel)}
      />
      <input
        className="theme-pattern-input"
        value={props.themeDraft.clusterPattern}
        onChange={(event) => {
          props.setThemePatternError(null);
          props.setThemeDraft((draft) => ({
            ...draft,
            clusterPattern: event.target.value,
          }));
        }}
        placeholder="Pattern (optional)"
        aria-invalid={props.themePatternError ? 'true' : undefined}
        aria-describedby={
          props.themePatternError
            ? `${props.elementIdPrefix}-theme-pattern-error-active`
            : undefined
        }
        onKeyDown={(event) => handleThemeEditorKeyDown(event, props.onSave, props.onCancel)}
      />
      {props.themePatternError ? (
        <div
          id={`${props.elementIdPrefix}-theme-pattern-error-active`}
          className="theme-pattern-error"
        >
          <ErrorSurface kind="validation" message={props.themePatternError} />
        </div>
      ) : null}
    </div>
  );
};

interface ThemeRowActionsProps {
  theme: types.Theme;
  isDefault: boolean;
  activeThemeId: string | null;
  themeDraft: ThemeDraft;
  onSave: () => void;
  onCancel: () => void;
  currentMatches: boolean;
  onEdit: (theme: types.Theme) => void;
  onDelete: (themeId: string) => void;
}

const isThemeSaveDisabled = (props: ThemeRowActionsProps) => {
  if (!props.currentMatches) {
    return false;
  }
  if (props.isDefault) {
    return true;
  }
  return (
    props.themeDraft.name === props.theme.name &&
    props.themeDraft.clusterPattern === props.theme.clusterPattern
  );
};

const ThemeRowActions = (props: ThemeRowActionsProps) => {
  if (props.activeThemeId === props.theme.id) {
    return (
      <>
        <button
          type="button"
          className="theme-action-button"
          onClick={props.onSave}
          disabled={isThemeSaveDisabled(props)}
          aria-label="Save changes to theme"
          title="Save changes to theme"
        >
          <CheckIcon width={16} height={16} />
        </button>
        <button
          type="button"
          className="theme-action-button"
          onClick={props.onCancel}
          aria-label="Cancel"
          title="Cancel — revert to saved theme"
        >
          <CloseIcon width={14} height={14} />
        </button>
      </>
    );
  }
  return (
    <>
      <button
        type="button"
        className="theme-action-button"
        onClick={() => props.onEdit(props.theme)}
        aria-label="Edit theme"
        title="Edit theme"
      >
        <EditIcon width={16} height={16} />
      </button>
      {props.isDefault ? (
        <span className="theme-action-spacer" />
      ) : (
        <button
          type="button"
          className="theme-action-button theme-action-delete"
          onClick={() => props.onDelete(props.theme.id)}
          aria-label="Delete theme"
          title="Delete theme"
        >
          <DeleteIcon width={16} height={16} />
        </button>
      )}
    </>
  );
};

interface ThemeRowProps extends ThemeRowSharedProps, Omit<ThemeDragHandleProps, 'isDefault'> {
  dropTargetThemeId: string | null;
  currentMatches: boolean;
  onEdit: (theme: types.Theme) => void;
  onDelete: (themeId: string) => void;
}

const ThemeRow = (props: ThemeRowProps) => (
  <div
    className={buildThemeRowClassName(
      props.theme.id,
      props.activeThemeId,
      props.draggingThemeId,
      props.dropTargetThemeId,
      props.isDefault
    )}
  >
    <ThemeDragHandle
      theme={props.theme}
      isDefault={props.isDefault}
      draggingThemeId={props.draggingThemeId}
      setDraggingThemeId={props.setDraggingThemeId}
      setDropTargetThemeId={props.setDropTargetThemeId}
      onDrop={props.onDrop}
      onKeyboardReorder={props.onKeyboardReorder}
    />
    <ThemeRowFields
      elementIdPrefix={props.elementIdPrefix}
      theme={props.theme}
      isDefault={props.isDefault}
      activeThemeId={props.activeThemeId}
      themeDraft={props.themeDraft}
      themePatternError={props.themePatternError}
      setThemeDraft={props.setThemeDraft}
      setThemePatternError={props.setThemePatternError}
      onSave={props.onSave}
      onCancel={props.onCancel}
    />
    <ThemeRowActions
      theme={props.theme}
      isDefault={props.isDefault}
      activeThemeId={props.activeThemeId}
      themeDraft={props.themeDraft}
      onSave={props.onSave}
      onCancel={props.onCancel}
      currentMatches={props.currentMatches}
      onEdit={props.onEdit}
      onDelete={props.onDelete}
    />
  </div>
);

const UnsavedDefaultThemePrompt = ({
  hasChanges,
  activeThemeId,
  defaultTheme,
  onSave,
}: {
  hasChanges: boolean;
  activeThemeId: string | null;
  defaultTheme: types.Theme | null;
  onSave: () => void;
}) => {
  if (!hasChanges || activeThemeId === DEFAULT_THEME_ID || !defaultTheme) {
    return null;
  }
  return (
    <div className="themes-unsaved-default" role="status">
      <span>There are unsaved changes. Save as default?</span>
      <button type="button" className="themes-unsaved-default-action" onClick={onSave}>
        Save
      </button>
    </div>
  );
};

const ThemesTable = ({ loading, children }: { loading: boolean; children: ReactNode }) => {
  if (loading) {
    return <div className="themes-loading">Loading themes...</div>;
  }
  return <div className="themes-table">{children}</div>;
};

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
    let current: number;

    if (field === 'hue') {
      current = paletteHue;
    } else if (field === 'saturation') {
      current = paletteSaturation;
    } else {
      current = paletteBrightness;
    }

    setPaletteDraft(String(current));
    setEditingPaletteField(field);
  };

  const handlePaletteValueCommit = () => {
    if (!editingPaletteField) {
      return;
    }
    const parsed = Number.parseInt(paletteDraft, 10);
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
    const plan = getThemeSavePlan(activeThemeId, themes, themeDraft);
    if (!plan) {
      return;
    }
    if (!plan.isDefault && !(await validateThemePatternDraft(plan.clusterPattern))) {
      return;
    }

    try {
      const updated = buildThemeFromCurrentAppearance({
        theme: plan.existing,
        name: plan.name,
        clusterPattern: plan.clusterPattern,
      });
      await saveThemeEntry(updated);
      setActiveThemeId(null);
      if (plan.isDefault) {
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

  const activeAppearanceValues = useMemo<ThemeAppearanceValues>(
    () => ({
      hue: paletteHue,
      saturation: paletteSaturation,
      brightness: paletteBrightness,
      accent: accentColor || '',
      link: linkColor || '',
    }),
    [accentColor, linkColor, paletteBrightness, paletteHue, paletteSaturation]
  );

  // True when the current live values match the saved theme exactly.
  const themeMatchesCurrent = useCallback(
    (theme: types.Theme): boolean =>
      doesThemeMatchCurrentAppearance(theme, resolvedMode, activeAppearanceValues),
    [activeAppearanceValues, resolvedMode]
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
    return buildThemeWithCurrentAppearance({
      theme,
      name,
      clusterPattern,
      resolvedMode,
      activeValues: activeAppearanceValues,
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
            <ThemesTable loading={themesLoading}>
              <UnsavedDefaultThemePrompt
                hasChanges={hasUnsavedDefaultThemeChanges}
                activeThemeId={activeThemeId}
                defaultTheme={defaultTheme}
                onSave={() => {
                  void handleSaveDefaultThemeFromPrompt();
                }}
              />
              {themes.map((theme) => (
                <ThemeRow
                  key={theme.id}
                  elementIdPrefix={elementIdPrefix}
                  theme={theme}
                  isDefault={isDefaultTheme(theme)}
                  activeThemeId={activeThemeId}
                  themeDraft={themeDraft}
                  themePatternError={themePatternError}
                  setThemeDraft={setThemeDraft}
                  setThemePatternError={setThemePatternError}
                  onSave={() => {
                    void handleSaveActiveTheme();
                  }}
                  onCancel={() => {
                    void handleCancelActiveTheme();
                  }}
                  draggingThemeId={draggingThemeId}
                  dropTargetThemeId={dropTargetThemeId}
                  setDraggingThemeId={setDraggingThemeId}
                  setDropTargetThemeId={setDropTargetThemeId}
                  onDrop={(themeId) => {
                    void handleThemeDrop(themeId);
                  }}
                  onKeyboardReorder={(themeId, offset) => {
                    void handleThemeKeyboardReorder(themeId, offset);
                  }}
                  currentMatches={themeMatchesCurrent(theme)}
                  onEdit={handleEnterEditMode}
                  onDelete={setDeleteConfirmThemeId}
                />
              ))}
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
                      aria-describedby={
                        themePatternError ? `${elementIdPrefix}-theme-pattern-error-new` : undefined
                      }
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
                        <ErrorSurface kind="validation" message={themePatternError} />
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
            </ThemesTable>
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

/**
 * frontend/src/ui/settings/sections/SettingsControls.tsx
 *
 * Shared building blocks for the settings sections: the label/control row
 * wrapper every preference renders, the integer preference input (with the
 * Enter-to-blur commit convention) and its row, and preference commands.
 */

import { errorHandler } from '@utils/errorHandler';
import type { ComponentType, ReactNode } from 'react';
import { useCallback, useState } from 'react';
import {
  type AppPreferenceKey,
  commitIntegerPreferenceInput,
  getIntegerPreferenceMetadata,
} from '@/core/settings/appPreferences';
import { usePreference } from '@/core/settings/usePreference';

/**
 * The standard settings row: title + help on the left, control on the right.
 * Pass the control's id as `controlId` when the title is its only name, so the
 * title labels it; controls that name themselves (switches, dropdowns, choice
 * groups, buttons) leave it out.
 */
export function SettingRow({
  title,
  help,
  controlId,
  children,
}: Readonly<{
  title: string;
  help: ReactNode;
  controlId?: string;
  children: ReactNode;
}>) {
  return (
    <div className="settings-row">
      <div className="settings-row-label">
        {controlId ? (
          <label className="settings-row-label-title" htmlFor={controlId}>
            {title}
          </label>
        ) : (
          <div className="settings-row-label-title">{title}</div>
        )}
        <div className="settings-row-label-help">{help}</div>
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

/** The same accessible choice group for appearance mode and panel position. */
export function SettingsChoiceButtons<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: Readonly<{
  value: T;
  options: ReadonlyArray<{
    value: T;
    label: string;
    icon: ComponentType<{ width?: number; height?: number }>;
  }>;
  onChange: (value: T) => void;
  ariaLabel: string;
}>) {
  return (
    <fieldset className="settings-choice-buttons" aria-label={ariaLabel}>
      {options.map((option) => {
        const Icon = option.icon;
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            className={`settings-choice-button${selected ? ' settings-choice-button--active' : ''}`}
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
          >
            <Icon width={18} height={18} />
            <span>{option.label}</span>
          </button>
        );
      })}
    </fieldset>
  );
}

/**
 * Numeric preference input bounded by the preference's metadata. Enter commits
 * by blurring (the blur handler owns normalization + persistence).
 */
function PreferenceNumberInput({
  id,
  prefKey,
  step,
  value,
  onChange,
  onCommit,
}: Readonly<{
  id: string;
  prefKey: AppPreferenceKey;
  step: number;
  value: string;
  onChange: (raw: string) => void;
  onCommit: (raw: string) => void;
}>) {
  const metadata = getIntegerPreferenceMetadata(prefKey);
  return (
    <input
      type="number"
      id={id}
      min={metadata.min}
      max={metadata.max}
      step={step}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => onCommit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export interface PreferenceNumberSetting {
  title: string;
  help: ReactNode;
  prefKey: AppPreferenceKey;
  persist: (value: number) => void;
  step: number;
  unit: string;
}

// Shows the preference owner's value; a draft exists only while the user types,
// so a value the owner settles on (including a rollback) shows as soon as the
// field is left.
export function PreferenceNumberRow({
  setting,
  id,
}: Readonly<{ setting: PreferenceNumberSetting; id: string }>) {
  const value = usePreference(setting.prefKey);
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <SettingRow title={setting.title} help={setting.help} controlId={id}>
      <div className="setting-item setting-item-inline">
        <PreferenceNumberInput
          id={id}
          prefKey={setting.prefKey}
          step={setting.step}
          value={draft ?? String(value)}
          onChange={setDraft}
          onCommit={(raw) => {
            commitIntegerPreferenceInput(setting.prefKey, raw, setting.persist, {
              defaultOnNonPositive: true,
            });
            setDraft(null);
          }}
        />{' '}
        {setting.unit}
      </div>
    </SettingRow>
  );
}

export function usePreferenceToggle({
  action,
  valueKey,
  persist,
}: {
  action: string;
  valueKey: string;
  persist: (value: boolean) => Promise<unknown>;
}) {
  return useCallback(
    async (value: boolean) => {
      try {
        await persist(value);
      } catch (error) {
        errorHandler.handle(error, { action, [valueKey]: value });
      }
    },
    [action, persist, valueKey]
  );
}

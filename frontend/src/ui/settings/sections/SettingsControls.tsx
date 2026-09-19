/**
 * frontend/src/ui/settings/sections/SettingsControls.tsx
 *
 * Shared building blocks for the settings sections: the label/control row
 * wrapper every preference renders, the integer preference input (with the
 * Enter-to-blur commit convention), and preference subscriptions/commands.
 */

import { errorHandler } from '@utils/errorHandler';
import type { ComponentType, ReactNode } from 'react';
import { useCallback, useSyncExternalStore } from 'react';
import { type AppEvents, eventBus } from '@/core/events';
import {
  type AppPreferenceKey,
  getIntegerPreferenceMetadata,
} from '@/core/settings/appPreferences';

/** The standard settings row: title + help on the left, control on the right. */
export function SettingRow({
  title,
  help,
  children,
}: Readonly<{
  title: string;
  help: ReactNode;
  children: ReactNode;
}>) {
  return (
    <div className="settings-row">
      <div className="settings-row-label">
        <div className="settings-row-label-title">{title}</div>
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
export function PreferenceNumberInput({
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

/** Read the preference owner directly, including optimistic updates and rollback. */
export function usePreferenceValue<T>(read: () => T, event: keyof AppEvents): T {
  const subscribe = useCallback((notify: () => void) => eventBus.on(event, notify), [event]);
  return useSyncExternalStore(subscribe, read);
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

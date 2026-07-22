/**
 * frontend/src/ui/settings/sections/SettingsControls.tsx
 *
 * Shared building blocks for the settings sections: the label/control row
 * wrapper every preference renders, the integer preference input (with the
 * Enter-to-blur commit convention), and the optimistic persist-then-revert
 * toggle handler.
 */

import { errorHandler } from '@utils/errorHandler';
import type { ReactNode } from 'react';
import { useCallback } from 'react';
import {
  type AppPreferenceKey,
  getIntegerPreferenceMetadata,
} from '@/core/settings/appPreferences';

/** The standard settings row: title + help on the left, control on the right. */
export function SettingRow({
  title,
  help,
  children,
}: {
  title: string;
  help: ReactNode;
  children: ReactNode;
}) {
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
}: {
  id: string;
  prefKey: AppPreferenceKey;
  step: number;
  value: string;
  onChange: (raw: string) => void;
  onCommit: (raw: string) => void;
}) {
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

/**
 * useOptimisticPreferenceToggle applies a boolean preference optimistically:
 * set local state, persist, and revert the state (with an error report tagged
 * `{ action, [valueKey]: value }`) if persistence fails.
 */
export function useOptimisticPreferenceToggle({
  action,
  valueKey,
  persist,
  setState,
}: {
  action: string;
  valueKey: string;
  persist: (value: boolean) => Promise<unknown>;
  setState: (value: boolean) => void;
}) {
  return useCallback(
    async (value: boolean) => {
      setState(value);
      try {
        await persist(value);
      } catch (error) {
        errorHandler.handle(error, { action, [valueKey]: value });
        // Revert on failure.
        setState(!value);
      }
    },
    [action, persist, setState, valueKey]
  );
}

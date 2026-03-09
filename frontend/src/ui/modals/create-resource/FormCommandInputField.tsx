/**
 * frontend/src/ui/modals/create-resource/FormCommandInputField.tsx
 *
 * A form field for container command and args. Provides three input modes
 * via a dropdown: Command (shell-style tokenisation), Shell Script (entire
 * text as a single array item), and Raw YAML (direct YAML sequence editing).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import type { FormFieldDefinition } from './formDefinitions';
import { INPUT_BEHAVIOR_PROPS } from './formUtils';
import {
  type CommandInputMode,
  inferMode,
  arrayToDisplayText,
  parseDisplayText,
} from './commandInputUtils';

interface FormCommandInputFieldProps {
  /** Field definition (used for key, label, placeholder). */
  field: FormFieldDefinition;
  /** Current value — expected to be a string[] from YAML, or undefined. */
  value: unknown;
  /** Called with the new string[] (or empty []) when the user commits a change. */
  onChange: (newValue: unknown) => void;
}

const MODE_OPTIONS: DropdownOption[] = [
  { value: 'command', label: 'Command' },
  { value: 'script', label: 'Shell Script' },
  { value: 'raw-yaml', label: 'Raw YAML' },
];

/**
 * FormCommandInputField — renders a mode dropdown alongside a text input
 * (Command mode) or textarea (Shell Script / Raw YAML mode). The user's
 * text is parsed according to the active mode and written back as a YAML
 * string array on blur.
 */
export function FormCommandInputField({
  field,
  value,
  onChange,
}: FormCommandInputFieldProps): React.ReactElement {
  // Normalise the external value to a string array.
  const arrValue: string[] = useMemo(
    () => (Array.isArray(value) ? value.map(String) : []),
    [value]
  );

  const [mode, setMode] = useState<CommandInputMode>(() => inferMode(arrValue));
  const [rawText, setRawText] = useState<string>(() =>
    arrayToDisplayText(arrValue, inferMode(arrValue))
  );
  const [error, setError] = useState<string | null>(null);

  // Track the last external value so we can detect upstream changes
  // (e.g., from the YAML editor) without overwriting in-progress edits.
  const lastExternalRef = useRef<string>(JSON.stringify(arrValue));

  useEffect(() => {
    const serialized = JSON.stringify(arrValue);
    if (serialized !== lastExternalRef.current) {
      lastExternalRef.current = serialized;
      setRawText(arrayToDisplayText(arrValue, mode));
      setError(null);
    }
  }, [arrValue, mode]);

  /** Parse raw text and propagate to the parent. */
  const commit = useCallback(() => {
    const parsed = parseDisplayText(rawText, mode);
    if (parsed === null) {
      setError('Invalid YAML sequence');
      return;
    }
    setError(null);
    lastExternalRef.current = JSON.stringify(parsed);
    onChange(parsed);
  }, [rawText, mode, onChange]);

  /** Switch modes, reformatting the current value. */
  const handleModeChange = useCallback(
    (nextValue: string | string[]) => {
      const nextMode = (Array.isArray(nextValue) ? nextValue[0] : nextValue) as CommandInputMode;
      // Parse current text in the old mode, then reformat for the new mode.
      const parsed = parseDisplayText(rawText, mode) ?? arrValue;
      setMode(nextMode);
      setRawText(arrayToDisplayText(parsed, nextMode));
      setError(null);
      // Commit the reformatted value so the YAML stays in sync.
      lastExternalRef.current = JSON.stringify(parsed);
      onChange(parsed);
    },
    [rawText, mode, arrValue, onChange]
  );

  const isTextarea = mode !== 'command';

  const placeholder =
    mode === 'command'
      ? field.placeholder
      : mode === 'script'
        ? 'Enter shell script…'
        : '- item1\n- item2';

  return (
    <div className="resource-form-command-input" data-field-key={field.key}>
      <div className="resource-form-command-input-row">
        <div className="resource-form-command-input-mode">
          <Dropdown
            options={MODE_OPTIONS}
            value={mode}
            onChange={handleModeChange}
            size="compact"
            ariaLabel={`${field.label} input mode`}
          />
        </div>
        {!isTextarea && (
          <input
            type="text"
            className="resource-form-input"
            value={rawText}
            placeholder={placeholder}
            {...INPUT_BEHAVIOR_PROPS}
            onChange={(e) => {
              setRawText(e.target.value);
              setError(null);
            }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              }
            }}
          />
        )}
      </div>
      {isTextarea && (
        <textarea
          className="resource-form-textarea resource-form-command-input-textarea"
          value={rawText}
          placeholder={placeholder}
          rows={4}
          {...INPUT_BEHAVIOR_PROPS}
          onChange={(e) => {
            setRawText(e.target.value);
            setError(null);
          }}
          onBlur={commit}
        />
      )}
      {error && <span className="resource-form-command-input-error">{error}</span>}
    </div>
  );
}

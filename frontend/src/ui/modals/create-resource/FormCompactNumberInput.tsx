import React from 'react';
import { INPUT_BEHAVIOR_PROPS } from './formUtils';

interface CompactNumberConstraints {
  min?: number;
  max?: number;
  integer?: boolean;
}

interface ParseCompactNumberOptions {
  allowEmpty?: boolean;
}

interface FormCompactNumberInputProps extends CompactNumberConstraints {
  dataFieldKey: string;
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  inputRef?: React.Ref<HTMLInputElement>;
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

/**
 * Keep integer-only number inputs constrained while typing.
 * - strips non-digit characters when integer mode is enabled
 * - removes negative sign when min is non-negative
 * - enforces max digit count based on integer max bounds
 */
export function sanitizeCompactNumberInput(
  rawValue: string,
  constraints: CompactNumberConstraints
): string {
  if (!constraints.integer) {
    return rawValue;
  }

  const digitsOnly = rawValue.replace(/[^\d-]/g, '');
  const normalized =
    typeof constraints.min === 'number' && constraints.min >= 0
      ? digitsOnly.replace(/-/g, '')
      : digitsOnly;

  if (normalized === '' || normalized === '-') {
    return '';
  }

  const maxDigits =
    typeof constraints.max === 'number' && Number.isInteger(constraints.max) && constraints.max >= 0
      ? String(constraints.max).length
      : undefined;

  if (typeof maxDigits === 'number' && normalized.length > maxDigits) {
    return normalized.slice(0, maxDigits);
  }

  return normalized;
}

/**
 * Parse and validate number-field input value.
 * Returns `null` for invalid values, `''` for valid empty values, or a numeric value.
 */
export function parseCompactNumberValue(
  rawValue: string,
  constraints: CompactNumberConstraints,
  options: ParseCompactNumberOptions = {}
): number | '' | null {
  const allowEmpty = options.allowEmpty ?? true;

  if (rawValue.trim() === '') {
    return allowEmpty ? '' : null;
  }

  const parsed = Number(rawValue);
  if (Number.isNaN(parsed)) {
    return null;
  }

  if (constraints.integer && !Number.isInteger(parsed)) {
    return null;
  }

  if (typeof constraints.min === 'number' && parsed < constraints.min) {
    return null;
  }

  if (typeof constraints.max === 'number' && parsed > constraints.max) {
    return null;
  }

  return parsed;
}

/**
 * Shared compact numeric input used by resource form number fields.
 * Applies common number semantics and browser-assistance disabling rules.
 */
export function FormCompactNumberInput({
  dataFieldKey,
  value,
  defaultValue,
  placeholder,
  min,
  max,
  integer,
  className = 'resource-form-input',
  style,
  inputRef,
  onChange,
}: FormCompactNumberInputProps): React.ReactElement {
  return (
    <input
      ref={inputRef}
      type="number"
      className={className}
      style={style}
      data-field-key={dataFieldKey}
      value={value}
      defaultValue={defaultValue}
      placeholder={placeholder}
      min={min}
      max={max}
      step={integer ? 1 : undefined}
      {...INPUT_BEHAVIOR_PROPS}
      onInput={(event) => {
        const target = event.currentTarget;
        const sanitized = sanitizeCompactNumberInput(target.value, { min, max, integer });
        if (sanitized !== target.value) {
          target.value = sanitized;
        }
      }}
      onChange={onChange}
    />
  );
}

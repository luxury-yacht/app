import React, { useMemo } from 'react';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';

interface FormTriStateBooleanDropdownProps {
  value: unknown;
  onChange: (value: boolean | undefined) => void;
  ariaLabel: string;
  className?: string;
  style?: React.CSSProperties;
  emptyLabel?: string;
  trueLabel?: string;
  falseLabel?: string;
}

/**
 * Normalize YAML values into tri-state dropdown primitives.
 */
function normalizeTriStateValue(value: unknown): string {
  if (value === true || value === 'true') return 'true';
  if (value === false || value === 'false') return 'false';
  return '';
}

/**
 * Shared tri-state boolean dropdown (`unset`, `true`, `false`).
 * Unset maps to omitted YAML fields in caller logic.
 */
export function FormTriStateBooleanDropdown({
  value,
  onChange,
  ariaLabel,
  className = 'resource-form-dropdown',
  style,
  emptyLabel = '-----',
  trueLabel = 'true',
  falseLabel = 'false',
}: FormTriStateBooleanDropdownProps): React.ReactElement {
  const options = useMemo(
    () => [
      { value: '', label: emptyLabel },
      { value: 'true', label: trueLabel },
      { value: 'false', label: falseLabel },
    ],
    [emptyLabel, trueLabel, falseLabel]
  );

  const normalized = normalizeTriStateValue(value);
  const unsetClass = normalized === '' ? ' resource-form-dropdown--unset' : '';

  return (
    <div className={`${className}${unsetClass}`} style={style}>
      <Dropdown
        options={options}
        value={normalized}
        onChange={(nextValue) => {
          const next = Array.isArray(nextValue) ? (nextValue[0] ?? '') : nextValue;
          if (next === 'true') {
            onChange(true);
            return;
          }
          if (next === 'false') {
            onChange(false);
            return;
          }
          onChange(undefined);
        }}
        ariaLabel={ariaLabel}
      />
    </div>
  );
}

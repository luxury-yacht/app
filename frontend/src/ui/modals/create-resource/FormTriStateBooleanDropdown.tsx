import React, { useMemo } from 'react';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';

interface FormTriStateBooleanDropdownProps {
  value: unknown;
  onChange: (value: boolean | undefined) => void;
  ariaLabel: string;
  className?: string;
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

  return (
    <div className={className}>
      <Dropdown
        options={options}
        value={normalizeTriStateValue(value)}
        onChange={(nextValue) => {
          const normalized = Array.isArray(nextValue) ? (nextValue[0] ?? '') : nextValue;
          if (normalized === 'true') {
            onChange(true);
            return;
          }
          if (normalized === 'false') {
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

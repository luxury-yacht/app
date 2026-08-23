/**
 * frontend/src/shared/components/dropdowns/Dropdown/DropdownFilterOption.tsx
 *
 * The shared option control for every multi-select dropdown in the app.
 *
 * Selection used to be a bare check glyph in an 8px cell, hand-rolled in seven
 * places. It gave the list no spine and never read as something you could click.
 * This owns that control so the checkbox, the required state, and their spacing
 * are decided once.
 */

import { CheckIcon, LockIcon } from '@shared/components/icons/SharedIcons';
import type React from 'react';

/**
 * `required` is on-and-not-yours-to-change. It is a state of the control, never
 * an extra word in the row: a label that explains itself competes with the
 * option's own label and breaks the alignment of every row it touches.
 */
export type DropdownFilterOptionState = 'on' | 'off' | 'required';

export interface DropdownFilterOptionProps {
  label: React.ReactNode;
  state: DropdownFilterOptionState;
  /**
   * Action rows ("Select all", "Select none") are commands, not selections, so
   * they render without a control rather than with a permanently empty one.
   */
  plain?: boolean;
  /**
   * Recede the label while the option is off. Opt-in, because it only reads
   * correctly where "off" means "removed from view" — in a filter menu most
   * options are off by default and dimming them would flag the normal case.
   */
  dimWhenOff?: boolean;
  className?: string;
  title?: string;
}

const BOX_ICON_SIZE = 10;

export const DropdownFilterOption: React.FC<DropdownFilterOptionProps> = ({
  label,
  state,
  plain = false,
  dimWhenOff = false,
  className,
  title,
}) => {
  const muted = dimWhenOff && state === 'off';
  return (
    <span
      className={['dropdown-filter-option', plain && 'dropdown-filter-option--action', className]
        .filter(Boolean)
        .join(' ')}
      title={title}
    >
      {!plain && (
        <span
          className={[
            'dropdown-filter-box',
            state === 'on' && 'dropdown-filter-box--on',
            state === 'required' && 'dropdown-filter-box--required',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-hidden="true"
        >
          {state === 'on' && <CheckIcon width={BOX_ICON_SIZE} height={BOX_ICON_SIZE} />}
          {state === 'required' && <LockIcon width={BOX_ICON_SIZE} height={BOX_ICON_SIZE} />}
        </span>
      )}
      <span
        className={['dropdown-filter-label', muted && 'dropdown-filter-label--muted']
          .filter(Boolean)
          .join(' ')}
      >
        {label}
      </span>
    </span>
  );
};

/** Convenience for the common boolean case. */
export const dropdownFilterOptionState = (
  isSelected: boolean,
  isRequired = false
): DropdownFilterOptionState => {
  if (isRequired) {
    return 'required';
  }
  return isSelected ? 'on' : 'off';
};

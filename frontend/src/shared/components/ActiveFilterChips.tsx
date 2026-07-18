import type React from 'react';
import '@styles/components/active-filter-chips.css';

export interface ActiveFilterChip {
  key: string;
  label: string;
  removeLabel: string;
  onRemove: () => void;
}

interface ActiveFilterChipsProps {
  ariaLabel: string;
  chips: ActiveFilterChip[];
  onClearAll: () => void;
  className?: string;
  /** Optional summary rendered before the filter controls. */
  summary?: React.ReactNode;
}

const ActiveFilterChips = ({
  ariaLabel,
  chips,
  onClearAll,
  className,
  summary,
}: ActiveFilterChipsProps) => {
  if (chips.length === 0 && !summary) {
    return null;
  }

  const classes = ['active-filter-chips', className].filter(Boolean).join(' ');

  return (
    <fieldset className={classes} aria-label={ariaLabel}>
      <legend className="active-filter-chips__legend">{ariaLabel}</legend>
      {summary}
      {chips.length > 0 && (
        <button
          type="button"
          className="active-filter-chip active-filter-chip--clear-all"
          onClick={onClearAll}
          aria-label="Clear all filters"
          title="Clear all filters"
        >
          Clear all
        </button>
      )}
      {chips.map((chip) => (
        <span key={chip.key} className="active-filter-chip">
          <span className="active-filter-chip__label">{chip.label}</span>
          <button
            type="button"
            className="active-filter-chip__remove"
            onClick={chip.onRemove}
            aria-label={chip.removeLabel}
            title={chip.removeLabel}
          >
            ×
          </button>
        </span>
      ))}
    </fieldset>
  );
};

export default ActiveFilterChips;

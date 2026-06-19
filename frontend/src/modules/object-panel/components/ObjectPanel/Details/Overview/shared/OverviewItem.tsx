/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem.tsx
 */

import React from 'react';

interface OverviewItemProps {
  label: string;
  value: React.ReactNode;
  fullWidth?: boolean;
}

export const OverviewItem: React.FC<OverviewItemProps> = ({ label, value, fullWidth = false }) => {
  // Collapse the row when there is nothing to show. Conditional rows are dropped upstream by the
  // renderer's `hidden` predicate; this guards the value-driven case (no value to display).
  if (value === undefined || value === null) {
    return null;
  }

  return (
    <div className={`overview-item${fullWidth ? ' full-width' : ''}`}>
      <span className="overview-label">{label}</span>
      <span className="overview-value">{value}</span>
    </div>
  );
};

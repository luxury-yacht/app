/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem.tsx
 */

import React from 'react';

interface OverviewItemProps {
  label: string;
  value: React.ReactNode;
  fullWidth?: boolean;
  hidden?: boolean;
}

export const OverviewItem: React.FC<OverviewItemProps> = ({
  label,
  value,
  fullWidth = false,
  hidden = false,
}) => {
  if (hidden || value === undefined || value === null) {
    return null;
  }

  return (
    <div className={`overview-item${fullWidth ? ' full-width' : ''}`}>
      <span className="overview-label">{label}</span>
      <span className="overview-value">{value}</span>
    </div>
  );
};

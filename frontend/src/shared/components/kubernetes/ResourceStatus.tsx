/**
 * frontend/src/shared/components/kubernetes/ResourceStatus.tsx
 *
 * UI component for ResourceStatus.
 * Handles rendering and interactions for the shared components.
 */

import React from 'react';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';

interface ResourceStatusProps {
  status?: string;
  statusSeverity?: string;
  ready?: string;
  phase?: string;
  conditions?: Array<{
    type: string;
    status: string;
    message?: string;
    reason?: string;
  }>;
  customLabel?: string;
}

export const ResourceStatus = React.memo<ResourceStatusProps>(
  ({ status, statusSeverity, ready, phase, conditions, customLabel = 'Status' }) => {
    // Determine what to display
    const displayValue = status || phase;
    const severity = statusSeverity || 'info';

    if (!displayValue && !ready && (!conditions || conditions.length === 0)) {
      return null;
    }

    return (
      <>
        {displayValue && (
          <OverviewItem
            label={customLabel}
            value={<span className={`status-badge ${severity.toLowerCase()}`}>{displayValue}</span>}
          />
        )}

        {ready && (
          <OverviewItem
            label="Ready"
            value={(() => {
              // Parse ready string if it's in "X/Y" format
              const parts = ready.split('/');
              if (parts.length === 2) {
                const readyCount = parseInt(parts[0]);
                const totalCount = parseInt(parts[1]);
                if (!isNaN(readyCount) && !isNaN(totalCount) && readyCount !== totalCount) {
                  return <span className="status-badge warning">{ready}</span>;
                }
              }
              return ready;
            })()}
          />
        )}

        {conditions && conditions.length > 0 && (
          <OverviewItem
            label="Conditions"
            value={
              <div className="conditions-list">
                {conditions.map((condition, index) => (
                  <div key={index} className="condition-item">
                    <span
                      className={`condition-type ${condition.status === 'True' ? 'true' : 'false'}`}
                    >
                      {condition.type}
                    </span>
                    {condition.message && (
                      <span className="condition-message">: {condition.message}</span>
                    )}
                  </div>
                ))}
              </div>
            }
          />
        )}
      </>
    );
  }
);

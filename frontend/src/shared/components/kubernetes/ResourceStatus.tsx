/**
 * frontend/src/shared/components/kubernetes/ResourceStatus.tsx
 *
 * UI component for ResourceStatus.
 * Handles rendering and interactions for the shared components.
 */

import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { backendStatusClass } from '@shared/utils/backendStatusPresentation';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import React from 'react';

interface ResourceStatusProps {
  status?: string;
  statusState?: string;
  statusPresentation?: string;
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
  ({ status, statusPresentation, ready, phase, conditions, customLabel = 'Status' }) => {
    // Determine what to display
    const displayValue = status || phase;
    const statusClass = backendStatusClass(statusPresentation);

    if (!displayValue && !ready && (!conditions || conditions.length === 0)) {
      return null;
    }

    return (
      <>
        {displayValue && (
          <OverviewItem
            label={customLabel}
            value={<span className={`status-text ${statusClass}`}>{displayValue}</span>}
          />
        )}

        {ready && (
          <OverviewItem
            label="Ready"
            value={(() => {
              // Parse ready string if it's in "X/Y" format
              const parts = ready.split('/');
              if (parts.length === 2) {
                const readyCount = parseInt(parts[0], 10);
                const totalCount = parseInt(parts[1], 10);
                if (
                  !Number.isNaN(readyCount) &&
                  !Number.isNaN(totalCount) &&
                  readyCount !== totalCount
                ) {
                  return <span className="status-text warning">{ready}</span>;
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
                {withStableListKeys(
                  conditions,
                  (condition) => `${condition.type}:${condition.status}:${condition.reason ?? ''}`
                ).map(({ key, value: condition }) => (
                  <div key={key} className="condition-item">
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

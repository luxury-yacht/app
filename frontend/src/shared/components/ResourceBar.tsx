/**
 * frontend/src/shared/components/ResourceBar.tsx
 *
 * UI component for ResourceBar.
 * Handles rendering and interactions for the shared components.
 */

import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import './ResourceBar.css';

interface ResourceBarProps {
  usage?: string;
  request?: string;
  limit?: string;
  allocatable?: string; // For nodes - total allocatable capacity
  type: 'cpu' | 'memory';
  showTooltip?: boolean;
  variant?: 'default' | 'compact';
  overcommitPercent?: number;
  metricsStale?: boolean;
  metricsError?: string;
  metricsLastUpdated?: Date;
  animationScopeKey?: string;
  showEmptyState?: boolean;
}

const ResourceBar: React.FC<ResourceBarProps> = ({
  usage = '-',
  request = '-',
  limit = '-',
  allocatable,
  type,
  showTooltip: enableTooltip = true,
  variant = 'default',
  overcommitPercent,
  metricsStale = false,
  metricsError,
  animationScopeKey,
  showEmptyState = true,
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<'top' | 'bottom'>('top');
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const [transitionsEnabled, setTransitionsEnabled] = useState(true);
  const lastScopeKeyRef = useRef<string | undefined>(undefined);

  const metricsState: 'error' | 'stale' | null = metricsError
    ? 'error'
    : metricsStale
      ? 'stale'
      : null;

  useEffect(() => {
    if (!animationScopeKey) {
      lastScopeKeyRef.current = undefined;
      setTransitionsEnabled(true);
      return;
    }

    if (lastScopeKeyRef.current === undefined) {
      lastScopeKeyRef.current = animationScopeKey;
      setTransitionsEnabled(true);
      return;
    }

    if (lastScopeKeyRef.current !== animationScopeKey) {
      lastScopeKeyRef.current = animationScopeKey;
      setTransitionsEnabled(false);

      if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
        setTransitionsEnabled(true);
      } else {
        window.requestAnimationFrame(() => {
          setTransitionsEnabled(true);
        });
      }
    }
  }, [animationScopeKey]);

  // Parse resource values to numbers
  const parseResource = (value: string | undefined): number => {
    if (!value || value === '-' || value === 'undefined' || value === 'null' || value === 'not set')
      return 0;

    try {
      if (type === 'cpu') {
        // Handle CPU (millicores or cores)
        if (value.endsWith('m')) {
          const parsed = parseFloat(value.slice(0, -1));
          return isNaN(parsed) ? 0 : parsed;
        } else {
          const parsed = parseFloat(value) * 1000; // Convert cores to millicores
          return isNaN(parsed) ? 0 : parsed;
        }
      } else {
        // Handle Memory - match DetailsTabUtilization's parseMemToMB exactly
        const num = parseFloat(value);
        if (isNaN(num)) return 0;

        if (value.endsWith('Ki')) {
          return num / 1024; // Convert Ki to Mi
        } else if (value.endsWith('Mi')) {
          return num; // Already in Mi
        } else if (value.endsWith('Gi')) {
          return num * 1024; // Convert Gi to Mi
        } else if (value.endsWith('GB')) {
          return num * 1024; // Convert GB to Mi
        } else if (value.endsWith('MB')) {
          return num; // Already in Mi
        } else {
          // No unit suffix - assume bytes
          return num / (1024 * 1024); // Convert bytes to Mi
        }
      }
    } catch (error) {
      console.warn('Error parsing resource value:', value, error);
      return 0;
    }
  };

  // Parse values
  const currentUsage = parseResource(usage);
  const currentRequest = parseResource(request);
  const currentLimit = parseResource(limit);
  const currentAllocatable = parseResource(allocatable);

  // Determine the maximum value for scaling
  // For nodes (with allocatable), use allocatable as scale
  // For pods, use Priority: Limit > Request > Usage
  let maxScale = 0;
  let isUnbounded = false;

  if (currentAllocatable > 0) {
    // Node resources - scale to allocatable capacity
    maxScale = currentAllocatable;
  } else if (currentLimit > 0) {
    // Pod resources - scale to limit
    maxScale = currentLimit;
  } else if (currentRequest > 0) {
    // If no limit, scale to max of usage and request (handle burst scenarios)
    maxScale = Math.max(currentUsage, currentRequest * 1.2);
  } else if (currentUsage > 0) {
    // No request or limit - this is unbounded usage
    // Show the actual usage without percentage
    maxScale = currentUsage;
    isUnbounded = true;
  }

  const usageVsLimit = currentLimit > 0 ? (currentUsage / currentLimit) * 100 : 0;
  const usageVsAllocatable = currentAllocatable > 0 ? (currentUsage / currentAllocatable) * 100 : 0;

  // Determine bar color based on usage thresholds
  let statusClass = '';

  if (currentAllocatable > 0) {
    // For nodes: use usage vs allocatable
    if (usageVsAllocatable >= 95) {
      statusClass = 'critical';
    } else if (usageVsAllocatable >= 81) {
      statusClass = 'warning';
    } else {
      statusClass = 'normal';
    }
  } else {
    // For pods: use existing logic with limits and requests
    // First check for over-consumption (usage > request)
    if (currentRequest > 0 && currentUsage > currentRequest) {
      // Over-consuming resources - always show warning
      if (currentLimit > 0 && usageVsLimit > 95) {
        statusClass = 'critical'; // Near or exceeding limit
      } else {
        statusClass = 'warning'; // Over request but not critical on limit
      }
    } else if (currentLimit > 0) {
      // Not over-consuming, check against limit
      if (usageVsLimit > 95) {
        statusClass = 'critical';
      } else if (usageVsLimit > 80) {
        statusClass = 'warning';
      } else {
        statusClass = 'normal';
      }
    } else if (currentRequest > 0) {
      // Have request but no limit, and not over-consuming
      statusClass = 'normal';
    } else {
      // No request or limit
      statusClass = 'unbounded';
    }
  }

  const containerClasses = [
    'resource-bar-container',
    variant === 'compact' ? 'resource-bar-compact' : '',
    statusClass,
    metricsState ? `metrics-${metricsState}` : '',
    transitionsEnabled ? '' : 'resource-bar-no-animation',
  ].filter(Boolean);

  // If no values, show empty state
  if (maxScale === 0) {
    return (
      <div className={containerClasses.join(' ')}>
        {showEmptyState ? (
          <div className="resource-bar-empty">
            <span>No data</span>
          </div>
        ) : (
          <div className="resource-bar-empty resource-bar-empty--suppressed" aria-hidden="true" />
        )}
      </div>
    );
  }

  // Calculate percentages
  const usagePercent = isUnbounded
    ? 100
    : Math.min(100, Math.max(0, (currentUsage / maxScale) * 100));
  const requestPercent =
    currentRequest > 0 ? Math.min(100, Math.max(0, (currentRequest / maxScale) * 100)) : 0;
  const limitPercent =
    currentLimit > 0 ? Math.min(100, Math.max(0, (currentLimit / maxScale) * 100)) : 0;

  // Check for configuration issues
  const hasConfigIssue = currentRequest > 0 && currentLimit > 0 && currentRequest > currentLimit;

  // Format values for display
  const formatValue = (value: string | undefined, parsedValue: number): string => {
    if (!value || value === '-' || value === 'undefined' || value === 'null') return '-';

    if (type === 'cpu') {
      // For CPU, 0 is a valid value (0 millicores)
      // Only return '-' if the original value was invalid
      if (isNaN(parsedValue)) return '-';
      return `${Math.round(parsedValue)}m`;
    } else {
      // For memory, 0 likely means parsing failed
      if (parsedValue === 0) return '-';
      if (parsedValue >= 1024) {
        return `${(parsedValue / 1024).toFixed(1)}Gi`;
      } else {
        return `${Math.round(parsedValue)}Mi`;
      }
    }
  };

  // Format tooltip values
  const tooltipUsage = formatValue(usage, currentUsage);
  const tooltipRequest = currentRequest > 0 ? formatValue(request, currentRequest) : 'Not set';
  const tooltipLimit = currentLimit > 0 ? formatValue(limit, currentLimit) : 'Not set';
  const tooltipAllocatable =
    currentAllocatable > 0 ? formatValue(allocatable, currentAllocatable) : 'Not set';
  const displayUsage = metricsState === 'error' ? '—' : tooltipUsage;

  // Calculate consumption metric (percentage of request)
  const consumption = currentRequest > 0 ? Math.round((currentUsage / currentRequest) * 100) : null;

  const handleMouseEnter = () => {
    // Only show tooltip in compact view
    if (!enableTooltip || variant !== 'compact') return;
    try {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const tooltipOffset = 4; // Small offset to stay close

        // Calculate position for fixed positioning
        let style: React.CSSProperties = {
          position: 'fixed',
          left: rect.left + rect.width / 2,
          transform: 'translateX(-50%)',
        };

        // Check space above
        const spaceAbove = rect.top;

        // Prefer positioning above, but switch to below if not enough space
        if (spaceAbove < 200) {
          // Position below
          style.top = rect.bottom + tooltipOffset;
          setTooltipPosition('bottom');
        } else {
          // Position above - directly above the element
          style.bottom = window.innerHeight - rect.top + tooltipOffset;
          setTooltipPosition('top');
        }

        setTooltipStyle(style);
        setShowTooltip(true);
      }
    } catch (error) {
      console.warn('Error showing ResourceBar tooltip:', error);
      setShowTooltip(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className={containerClasses.join(' ')}
      onMouseEnter={enableTooltip ? handleMouseEnter : undefined}
      onMouseLeave={enableTooltip ? () => setShowTooltip(false) : undefined}
    >
      {/* Show usage value above bar in compact mode */}
      {variant === 'compact' && (
        <div className="resource-bar-value">
          <span className="resource-bar-leading">{displayUsage}</span>
        </div>
      )}
      <div className="resource-bar">
        {/* Background track */}
        <div className="resource-bar-track">
          {/* Usage fill */}
          <div
            className={`resource-bar-usage ${statusClass}`}
            style={{ width: `${usagePercent}%` }}
          >
            {/* No inline text on the bar */}
          </div>

          {/* Reserved but unused area (if request > usage) */}
          {currentRequest > currentUsage && requestPercent > usagePercent && (
            <div
              className="resource-bar-reserved"
              style={{
                left: `${usagePercent}%`,
                width: `${requestPercent - usagePercent}%`,
              }}
            />
          )}

          {/* Request marker - show in default variant, and in compact for pods (no allocatable) */}
          {currentRequest > 0 &&
            (variant === 'default' || (variant === 'compact' && !currentAllocatable)) && (
              <div
                className="resource-bar-marker request"
                style={{ left: `${requestPercent}%` }}
                title={`Request: ${tooltipRequest}`}
              />
            )}

          {/* Limit marker - only show in default variant */}
          {currentLimit > 0 && variant === 'default' && (
            <div
              className="resource-bar-marker limit"
              style={{ left: `${limitPercent}%` }}
              title={`Limit: ${tooltipLimit}`}
            />
          )}
        </div>
      </div>
      {/* Show overcommit bar below main bar for nodes in compact mode */}
      {variant === 'compact' && overcommitPercent && overcommitPercent > 0 && (
        <div className="resource-bar-overcommit">
          <div className="resource-bar-overcommit-track">
            <div
              className="resource-bar-overcommit-fill"
              style={{ width: `${Math.min(100, overcommitPercent)}%` }}
            />
          </div>
        </div>
      )}
      {showTooltip &&
        tooltipStyle &&
        ReactDOM.createPortal(
          <div
            className={`resource-bar-tooltip tooltip-${tooltipPosition}`}
            style={{ ...tooltipStyle, fontSize: '0.85rem' }}
          >
            <div className="tooltip-content">
              <div className="tooltip-row">
                <span>Usage:</span>
                <span className="tooltip-value">{tooltipUsage}</span>
                <span className="tooltip-value">
                  {currentAllocatable > 0 && `${Math.round(usageVsAllocatable)}%`}
                  {!currentAllocatable && currentLimit > 0 && `${Math.round(usageVsLimit)}%`}
                </span>
              </div>

              {currentAllocatable > 0 && (
                <div className="tooltip-row">
                  <span>Allocatable:</span>
                  <span className="tooltip-value">{tooltipAllocatable}</span>
                  <span className="tooltip-value"></span>
                </div>
              )}

              {currentAllocatable > 0 && <div className="tooltip-divider" />}
              {!currentAllocatable && <div className="tooltip-divider" />}
              <div className="tooltip-row">
                <span>Requests:</span>
                <span className="tooltip-value">{currentRequest > 0 ? tooltipRequest : '-'}</span>
                <span className="tooltip-value">
                  {currentRequest > 0 &&
                    currentAllocatable > 0 &&
                    `${Math.round((currentRequest / currentAllocatable) * 100)}%`}
                  {currentRequest > 0 &&
                    !currentAllocatable &&
                    currentLimit > 0 &&
                    `${Math.round((currentRequest / currentLimit) * 100)}%`}
                </span>
              </div>
              <div className="tooltip-row">
                <span>Limits:</span>
                <span className="tooltip-value">{currentLimit > 0 ? tooltipLimit : '-'}</span>
                <span
                  className={`tooltip-value ${currentLimit > 0 && currentAllocatable > 0 && (currentLimit / currentAllocatable) * 100 > 100 ? 'warning' : ''}`}
                >
                  {currentLimit > 0 &&
                    currentAllocatable > 0 &&
                    `${Math.round((currentLimit / currentAllocatable) * 100)}%`}
                </span>
              </div>

              {hasConfigIssue && (
                <div className="tooltip-row warning">
                  <span>⚠️ Requests exceeds Limits</span>
                </div>
              )}

              {(consumption !== null ||
                (overcommitPercent && overcommitPercent > 0) ||
                (!currentRequest && !currentLimit)) && <div className="tooltip-divider" />}
              {consumption !== null && (
                <div className="tooltip-row">
                  <span>Consumption:</span>
                  <span className="tooltip-value">{tooltipUsage}</span>
                  <span className={`tooltip-value ${consumption > 100 ? 'warning' : ''}`}>
                    {consumption}%
                  </span>
                </div>
              )}

              {currentAllocatable > 0 && currentLimit > currentAllocatable && (
                <div className="tooltip-row">
                  <span>Overcommitted:</span>
                  <span className="tooltip-value">
                    {formatValue(limit, currentLimit - currentAllocatable)}
                  </span>
                  <span className="tooltip-value warning">
                    {`${Math.round(((currentLimit - currentAllocatable) / currentAllocatable) * 100)}%`}
                  </span>
                </div>
              )}

              {!currentRequest && !currentLimit && (
                <div className="tooltip-row warning">
                  <span>⚠️ No resource constraints set</span>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default ResourceBar;

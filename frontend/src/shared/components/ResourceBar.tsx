/**
 * frontend/src/shared/components/ResourceBar.tsx
 *
 * UI component for ResourceBar.
 * Handles rendering and interactions for the shared components.
 */

import type { ResourceType } from '@shared/utils/resourceCalculations';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { createResourceBarModel, type ResourceBarModel } from './resourceBarModel';
import Tooltip from './Tooltip';
import './ResourceBar.css';

interface ResourceBarProps {
  usage?: string;
  request?: string;
  limit?: string;
  allocatable?: string;
  'data-gridtable-export-text'?: string;
  type: ResourceType;
  showTooltip?: boolean;
  variant?: 'default' | 'compact';
  overcommitPercent?: number;
  metricsStale?: boolean;
  metricsError?: string;
  metricsLastUpdated?: Date;
  animationScopeKey?: string;
  showEmptyState?: boolean;
}

type ResourceBarVariant = NonNullable<ResourceBarProps['variant']>;
type MetricsState = 'error' | 'stale' | null;

const getMetricsState = (metricsError: string | undefined, metricsStale: boolean): MetricsState => {
  if (metricsError) {
    return 'error';
  }
  return metricsStale ? 'stale' : null;
};

const useResourceBarTransitions = (animationScopeKey: string | undefined): boolean => {
  const [transitionsEnabled, setTransitionsEnabled] = useState(true);
  const lastScopeKeyRef = useRef<string | undefined>(undefined);

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
        return;
      }

      window.requestAnimationFrame(() => {
        setTransitionsEnabled(true);
      });
    }
  }, [animationScopeKey]);

  return transitionsEnabled;
};

const ResourceBarEmptyState = ({
  containerClasses,
  showEmptyState,
}: {
  containerClasses: string;
  showEmptyState: boolean;
}) => (
  <div className={containerClasses}>
    {showEmptyState ? (
      <div className="resource-bar-empty">
        <span>No data</span>
      </div>
    ) : (
      <div className="resource-bar-empty resource-bar-empty--suppressed" aria-hidden="true" />
    )}
  </div>
);

const getUsageReferencePercent = (model: ResourceBarModel): number | null => {
  if (model.allocatable > 0) {
    return model.usageVsAllocatable;
  }
  return model.limit > 0 ? model.usageVsLimit : null;
};

const getRequestReferencePercent = (model: ResourceBarModel): number | null => {
  if (model.request === 0) {
    return null;
  }
  if (model.allocatable > 0) {
    return (model.request / model.allocatable) * 100;
  }
  return model.limit > 0 ? (model.request / model.limit) * 100 : null;
};

const ResourceBarTooltipSummary = ({ model }: { model: ResourceBarModel }) => {
  const usageReferencePercent = getUsageReferencePercent(model);

  return (
    <>
      <div className="rb-tooltip-row">
        <span>Usage:</span>
        <span className="rb-tooltip-value">{model.formattedUsage}</span>
        <span className="rb-tooltip-value">
          {usageReferencePercent === null ? '' : `${Math.round(usageReferencePercent)}%`}
        </span>
      </div>

      {model.allocatable > 0 && (
        <div className="rb-tooltip-row">
          <span>Allocatable:</span>
          <span className="rb-tooltip-value">{model.formattedAllocatable}</span>
          <span className="rb-tooltip-value"></span>
        </div>
      )}

      <div className="rb-tooltip-divider" />
    </>
  );
};

const ResourceBarTooltipConstraints = ({ model }: { model: ResourceBarModel }) => {
  const requestReferencePercent = getRequestReferencePercent(model);
  const limitReferencePercent =
    model.limit > 0 && model.allocatable > 0 ? (model.limit / model.allocatable) * 100 : null;

  return (
    <>
      <div className="rb-tooltip-row">
        <span>Requests:</span>
        <span className="rb-tooltip-value">{model.request > 0 ? model.formattedRequest : '-'}</span>
        <span className="rb-tooltip-value">
          {requestReferencePercent === null ? '' : `${Math.round(requestReferencePercent)}%`}
        </span>
      </div>
      <div className="rb-tooltip-row">
        <span>Limits:</span>
        <span className="rb-tooltip-value">{model.limit > 0 ? model.formattedLimit : '-'}</span>
        <span
          className={`rb-tooltip-value ${limitReferencePercent !== null && limitReferencePercent > 100 ? 'warning' : ''}`}
        >
          {limitReferencePercent === null ? '' : `${Math.round(limitReferencePercent)}%`}
        </span>
      </div>

      {model.hasConfigIssue ? (
        <div className="rb-tooltip-row warning">
          <span>⚠️ Requests exceeds Limits</span>
        </div>
      ) : null}
    </>
  );
};

const ResourceBarTooltipConsumption = ({
  model,
  overcommitPercent,
}: {
  model: ResourceBarModel;
  overcommitPercent: number | undefined;
}) => {
  const hasNoConstraints = model.request === 0 && model.limit === 0;
  const hasOvercommitBar = Boolean(overcommitPercent && overcommitPercent > 0);
  const showDivider = model.consumption !== null || hasOvercommitBar || hasNoConstraints;

  return (
    <>
      {showDivider ? <div className="rb-tooltip-divider" /> : null}
      {model.consumption !== null && (
        <div className="rb-tooltip-row">
          <span>Consumption:</span>
          <span className="rb-tooltip-value">{model.formattedUsage}</span>
          <span className={`rb-tooltip-value ${model.consumption > 100 ? 'warning' : ''}`}>
            {model.consumption}%
          </span>
        </div>
      )}

      {model.overcommittedAmount > 0 && (
        <div className="rb-tooltip-row">
          <span>Overcommitted:</span>
          <span className="rb-tooltip-value">{model.formattedOvercommitted}</span>
          <span className="rb-tooltip-value warning">{`${model.overcommittedPercent}%`}</span>
        </div>
      )}

      {hasNoConstraints ? (
        <div className="rb-tooltip-row warning">
          <span>⚠️ No resource constraints set</span>
        </div>
      ) : null}
    </>
  );
};

const ResourceBarTooltipContent = ({
  model,
  overcommitPercent,
}: {
  model: ResourceBarModel;
  overcommitPercent: number | undefined;
}) => (
  <div className="rb-tooltip-content">
    <ResourceBarTooltipSummary model={model} />
    <ResourceBarTooltipConstraints model={model} />
    <ResourceBarTooltipConsumption model={model} overcommitPercent={overcommitPercent} />
  </div>
);

const ResourceBarTrack = ({
  model,
  variant,
}: {
  model: ResourceBarModel;
  variant: ResourceBarVariant;
}) => {
  const showRequestMarker = model.request > 0 && (variant === 'default' || model.allocatable === 0);

  return (
    <div className="resource-bar">
      <div className="resource-bar-track">
        <div
          className={`resource-bar-usage ${model.status}`}
          style={{ width: `${model.usagePercent}%` }}
        />

        {model.showReserved ? (
          <div
            className="resource-bar-reserved"
            style={{
              left: `${model.usagePercent}%`,
              width: `${model.requestPercent - model.usagePercent}%`,
            }}
          />
        ) : null}

        {model.showOverLimit ? (
          <div
            className="resource-bar-overlimit"
            style={{
              left: `${model.limitPercent}%`,
              width: `${model.usagePercent - model.limitPercent}%`,
            }}
          />
        ) : null}

        {showRequestMarker ? (
          <div
            className="resource-bar-marker request"
            style={{ left: `${model.requestPercent}%` }}
            title={`Request: ${model.formattedRequest}`}
          />
        ) : null}

        {model.limit > 0 && variant === 'default' && (
          <div
            className="resource-bar-marker limit"
            style={{ left: `${model.limitPercent}%` }}
            title={`Limit: ${model.formattedLimit}`}
          />
        )}
      </div>
    </div>
  );
};

const ResourceBarOvercommit = ({
  variant,
  overcommitPercent,
}: {
  variant: ResourceBarVariant;
  overcommitPercent: number | undefined;
}) => {
  if (variant !== 'compact' || !overcommitPercent || overcommitPercent <= 0) {
    return null;
  }

  return (
    <div className="resource-bar-overcommit">
      <div className="resource-bar-overcommit-track">
        <div
          className="resource-bar-overcommit-fill"
          style={{ width: `${Math.min(100, overcommitPercent)}%` }}
        />
      </div>
    </div>
  );
};

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
  const containerRef = useRef<HTMLDivElement>(null);
  const transitionsEnabled = useResourceBarTransitions(animationScopeKey);
  const metricsState = getMetricsState(metricsError, metricsStale);
  const model = createResourceBarModel({ usage, request, limit, allocatable, type });
  const containerClasses = [
    'resource-bar-container',
    variant === 'compact' ? 'resource-bar-compact' : '',
    model.status,
    metricsState ? `metrics-${metricsState}` : '',
    transitionsEnabled ? '' : 'resource-bar-no-animation',
  ]
    .filter(Boolean)
    .join(' ');

  if (model.maxScale === 0) {
    return (
      <ResourceBarEmptyState containerClasses={containerClasses} showEmptyState={showEmptyState} />
    );
  }

  const displayUsage = metricsState === 'error' ? '—' : model.formattedUsage;

  return (
    <Tooltip
      content={<ResourceBarTooltipContent model={model} overcommitPercent={overcommitPercent} />}
      placement="top"
      maxWidth={220}
      minWidth={220}
      disabled={!enableTooltip || variant !== 'compact'}
      inline={false}
    >
      <div ref={containerRef} className={containerClasses}>
        {variant === 'compact' && (
          <div className="resource-bar-value">
            <span className="resource-bar-leading">{displayUsage}</span>
          </div>
        )}
        <ResourceBarTrack model={model} variant={variant} />
        <ResourceBarOvercommit variant={variant} overcommitPercent={overcommitPercent} />
      </div>
    </Tooltip>
  );
};

export default ResourceBar;

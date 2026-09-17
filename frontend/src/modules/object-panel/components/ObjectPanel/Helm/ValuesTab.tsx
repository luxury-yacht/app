/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Helm/ValuesTab.tsx
 */

import ClusterDataPausedState from '@shared/components/ClusterDataPausedState';
import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import SegmentedButton from '@shared/components/SegmentedButton';
import { YamlEditor } from '@shared/components/yaml';
import { errorHandler } from '@utils/errorHandler';
import type React from 'react';
import { useMemo, useState } from 'react';
import * as YAML from 'yaml';
import { useRefreshDomainHandle } from '@/core/data-access';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import { applyPassiveLoadingPolicy } from '@/core/refresh/loadingPolicy';
import { type HelmValuesData, type HelmValuesMode, selectHelmValues } from './helmValues';
import './ValuesTab.css';
import '../Yaml/YamlTab.css';

interface ValuesTabProps {
  scope: string | null;
  isActive?: boolean;
}

const ValuesTab: React.FC<ValuesTabProps> = ({ scope, isActive = false }) => {
  const { isPaused, isManualRefreshActive } = useAutoRefreshLoadingState();
  const [showMode, setShowMode] = useState<HelmValuesMode>('defaults');
  const { state: snapshot } = useRefreshDomainHandle({
    domain: 'object-helm-values',
    scope,
    enabled: Boolean(isActive && scope),
    preserveState: true,
    fetchOnEnable: isActive && scope ? 'startup' : false,
  });

  const valuesData = snapshot.data?.values as HelmValuesData | undefined;
  const valuesLoadingState = applyPassiveLoadingPolicy({
    loading:
      snapshot.status === 'loading' ||
      snapshot.status === 'initialising' ||
      (snapshot.status === 'updating' && !valuesData),
    hasLoaded: Boolean(snapshot.data),
    hasData: Boolean(valuesData),
    isPaused,
    isManualRefreshActive,
  });
  const valuesLoading = valuesLoadingState.loading;
  const showPausedValuesState = valuesLoadingState.showPausedEmptyState;
  const valuesError = snapshot.error ?? null;

  const displayContent = useMemo(() => {
    if (!valuesData) {
      return '';
    }

    const content = selectHelmValues(valuesData, showMode);

    try {
      return YAML.stringify(content ?? {}, {
        indent: 2,
        lineWidth: 0,
        doubleQuotedAsJSON: false,
        singleQuote: false,
        defaultKeyType: 'PLAIN',
        defaultStringType: 'PLAIN',
      });
    } catch (e) {
      errorHandler.handle(e, { action: 'processHelmValues' });
      return YAML.stringify(content ?? {});
    }
  }, [valuesData, showMode]);

  if (valuesLoading) {
    return (
      <div className="object-panel-tab-content">
        <LoadingSpinner message="Loading values..." />
      </div>
    );
  }

  if (showPausedValuesState) {
    return (
      <div className="object-panel-tab-content">
        <div className="yaml-display-empty">
          <ClusterDataPausedState />
        </div>
      </div>
    );
  }

  if (valuesError) {
    return (
      <div className="object-panel-tab-content">
        <div className="yaml-display-error">
          <div className="error-message">
            Error loading values: <ErrorSurface kind="reported" message={valuesError} />
          </div>
        </div>
      </div>
    );
  }

  if (!valuesData) {
    return (
      <div className="object-panel-tab-content">
        <div className="yaml-display-empty">
          <p>No values available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="object-panel-tab-content">
      <div className="values-display">
        <YamlEditor
          value={displayContent}
          editable={false}
          active={isActive}
          shortcutLabel="Helm values search"
          shortcutPriority={20}
          ariaLabel="Helm values YAML"
          toolbarActions={
            <SegmentedButton
              options={[
                { label: 'Defaults', value: 'defaults' },
                { label: 'Overrides', value: 'overrides' },
                { label: 'Merged', value: 'merged' },
              ]}
              value={showMode}
              onChange={(value) => setShowMode(value as typeof showMode)}
            />
          }
        />
      </div>
    </div>
  );
};

export default ValuesTab;

/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Helm/ValuesTab.tsx
 */

import type { Extension } from '@codemirror/state';
import ClusterDataPausedState from '@shared/components/ClusterDataPausedState';
import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import SegmentedButton from '@shared/components/SegmentedButton';
import { YamlEditor } from '@shared/components/yaml';
import type React from 'react';
import { useMemo, useState } from 'react';
import { useRefreshDomainHandle } from '@/core/data-access';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import { applyPassiveLoadingPolicy } from '@/core/refresh/loadingPolicy';
import { helmValuesOverrideGutter } from './helmValuesOverrideGutter';
import {
  computeHelmValuesOverrideMarks,
  type HelmValuesOverrideMarks,
  stringifyHelmValues,
} from './helmValuesOverrideMarks';
import { getHelmValuesView, type HelmValuesView, setHelmValuesView } from './helmValuesViewCache';
import '../Yaml/YamlTab.css';
import './ValuesTab.css';
import { failureMessage } from '@/core/refresh/refreshFailure';

const VIEW_OPTIONS: { label: string; value: HelmValuesView }[] = [
  { label: 'Defaults', value: 'defaults' },
  { label: 'Overrides', value: 'overrides' },
  { label: 'Merged', value: 'merged' },
];

const NO_EXTENSIONS: Extension[] = [];

const overrideSummary = (marks: HelmValuesOverrideMarks) => {
  const parts: string[] = [];
  if (marks.overriddenCount > 0) {
    parts.push(`${marks.overriddenCount} overridden`);
  }
  if (marks.removedCount > 0) {
    parts.push(`${marks.removedCount} removed`);
  }
  return parts.join(' · ') || 'No overrides';
};

interface ValuesTabProps {
  scope: string | null;
  isActive?: boolean;
  panelId: string;
}

const ValuesTab: React.FC<ValuesTabProps> = ({ scope, isActive = false, panelId }) => {
  const { isPaused, isManualRefreshActive } = useAutoRefreshLoadingState();
  const [view, setView] = useState<HelmValuesView>(() => getHelmValuesView(panelId) ?? 'defaults');
  const { state: snapshot } = useRefreshDomainHandle({
    domain: 'object-helm-values',
    scope,
    enabled: Boolean(isActive && scope),
    preserveState: true,
    fetchOnEnable: isActive && scope ? 'startup' : false,
  });

  const valuesData = snapshot.data;
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
  const valuesError = failureMessage(snapshot.error);

  const displayContent = useMemo(
    () => (valuesData ? stringifyHelmValues(valuesData[view] ?? {}) : ''),
    [valuesData, view]
  );
  // Defaults holds only chart values, so only Merged and Overrides are marked.
  const markedView = view === 'defaults' ? null : view;
  const overrideMarks = useMemo(
    () =>
      markedView && valuesData
        ? computeHelmValuesOverrideMarks(displayContent, valuesData, markedView)
        : null,
    [displayContent, valuesData, markedView]
  );
  const overrideExtensions = useMemo(
    () => (overrideMarks ? [helmValuesOverrideGutter(overrideMarks)] : NO_EXTENSIONS),
    [overrideMarks]
  );

  const selectView = (next: HelmValuesView) => {
    setView(next);
    setHelmValuesView(panelId, next);
  };

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
      <div className="yaml-display">
        <YamlEditor
          value={displayContent}
          editable={false}
          active={isActive}
          shortcutLabel="Helm values search"
          shortcutPriority={20}
          ariaLabel="Helm values YAML"
          extraExtensions={overrideExtensions}
          toolbarActions={
            <>
              <SegmentedButton options={VIEW_OPTIONS} value={view} onChange={selectView} />
              {!!overrideMarks && (
                <span className="helm-values-override-summary">
                  {overrideSummary(overrideMarks)}
                </span>
              )}
            </>
          }
        />
      </div>
    </div>
  );
};

export default ValuesTab;

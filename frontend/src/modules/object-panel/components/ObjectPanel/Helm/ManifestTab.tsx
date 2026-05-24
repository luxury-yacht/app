/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Helm/ManifestTab.tsx
 */

import React, { useEffect } from 'react';
import ClusterDataPausedState from '@shared/components/ClusterDataPausedState';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import { YamlEditor } from '@shared/components/yaml';
import { requestRefreshDomain } from '@/core/data-access';
import { refreshOrchestrator } from '@/core/refresh';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import { applyPassiveLoadingPolicy } from '@/core/refresh/loadingPolicy';
import { useRefreshScopedDomain } from '@/core/refresh/store';
import '../Yaml/YamlTab.css';

const INACTIVE_SCOPE = '__inactive__';

interface ManifestTabProps {
  scope: string | null;
  isActive?: boolean;
}

const ManifestTab: React.FC<ManifestTabProps> = ({ scope, isActive = false }) => {
  const { isPaused, isManualRefreshActive } = useAutoRefreshLoadingState();
  const effectiveScope = scope ?? INACTIVE_SCOPE;
  const snapshot = useRefreshScopedDomain('object-helm-manifest', effectiveScope);

  // Enable/disable the scoped domain based on tab activity. preserveState
  // keeps the store entry alive when the tab unmounts so diagnostics can still
  // see it. Full cleanup (reset) is handled by ObjectPanelContent when the
  // panel closes.
  useEffect(() => {
    if (!scope) {
      return undefined;
    }

    const enabled = isActive;
    refreshOrchestrator.setScopedDomainEnabled('object-helm-manifest', scope, enabled);
    if (enabled) {
      void requestRefreshDomain({
        domain: 'object-helm-manifest',
        scope,
        reason: 'startup',
      });
    }

    return () => {
      refreshOrchestrator.setScopedDomainEnabled('object-helm-manifest', scope, false, {
        preserveState: true,
      });
    };
  }, [scope, isActive]);

  const manifestContent = snapshot.data?.manifest ?? '';
  const manifestLoadingState = applyPassiveLoadingPolicy({
    loading:
      snapshot.status === 'loading' ||
      snapshot.status === 'initialising' ||
      (snapshot.status === 'updating' && !manifestContent),
    hasLoaded: Boolean(snapshot.data),
    hasData: Boolean(manifestContent),
    isPaused,
    isManualRefreshActive,
  });
  const manifestLoading = manifestLoadingState.loading;
  const showPausedManifestState = manifestLoadingState.showPausedEmptyState;
  const manifestError = snapshot.error ?? null;

  if (manifestLoading) {
    return (
      <div className="object-panel-tab-content">
        <LoadingSpinner message="Loading manifest..." />
      </div>
    );
  }

  if (showPausedManifestState) {
    return (
      <div className="object-panel-tab-content">
        <div className="yaml-display-empty">
          <ClusterDataPausedState />
        </div>
      </div>
    );
  }

  if (manifestError) {
    return (
      <div className="object-panel-tab-content">
        <div className="yaml-display-error">
          <div className="error-message">Error loading manifest: {manifestError}</div>
        </div>
      </div>
    );
  }

  if (!manifestContent) {
    return (
      <div className="object-panel-tab-content">
        <div className="yaml-display-empty">
          <p>No manifest content available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="object-panel-tab-content">
      <div className="yaml-display">
        <YamlEditor
          value={manifestContent}
          editable={false}
          active={isActive}
          shortcutLabel="Helm manifest search"
          shortcutPriority={20}
          ariaLabel="Helm manifest YAML"
        />
      </div>
    </div>
  );
};

export default ManifestTab;

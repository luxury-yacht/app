/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Helm/ManifestTab.tsx
 */

import React from 'react';
import ClusterDataPausedState from '@shared/components/ClusterDataPausedState';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import { YamlEditor } from '@shared/components/yaml';
import { useRefreshDomainHandle } from '@/core/data-access';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import { applyPassiveLoadingPolicy } from '@/core/refresh/loadingPolicy';
import '../Yaml/YamlTab.css';

interface ManifestTabProps {
  scope: string | null;
  isActive?: boolean;
}

const ManifestTab: React.FC<ManifestTabProps> = ({ scope, isActive = false }) => {
  const { isPaused, isManualRefreshActive } = useAutoRefreshLoadingState();
  const { state: snapshot } = useRefreshDomainHandle({
    domain: 'object-helm-manifest',
    scope,
    enabled: Boolean(isActive && scope),
    preserveState: true,
    fetchOnEnable: isActive && scope ? 'startup' : false,
  });

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

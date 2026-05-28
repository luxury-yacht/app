/**
 * frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelContent.tsx
 *
 * Renders the content of the object panel based on the active tab and provided props.
 * Each tab is conditionally rendered and wrapped in an error boundary for robustness.
 */
import { useEffect } from 'react';
import type { types } from '@wailsjs/go/models';
import { refreshOrchestrator } from '@/core/refresh';
import DetailsTab from '@modules/object-panel/components/ObjectPanel/Details/DetailsTab';
import type { DetailsTabProps } from '@modules/object-panel/components/ObjectPanel/Details/DetailsTab';
import LogViewer from '@modules/object-panel/components/ObjectPanel/Logs/LogViewer';
import EventsTab from '@modules/object-panel/components/ObjectPanel/Events/EventsTab';
import MapTab from '@modules/object-panel/components/ObjectPanel/Map/MapTab';
import YamlTab from '@modules/object-panel/components/ObjectPanel/Yaml/YamlTab';
import ManifestTab from '@modules/object-panel/components/ObjectPanel/Helm/ManifestTab';
import ValuesTab from '@modules/object-panel/components/ObjectPanel/Helm/ValuesTab';
import ShellTab from '@modules/object-panel/components/ObjectPanel/Shell/ShellTab';
import NodeLogsTab from '@modules/object-panel/components/ObjectPanel/NodeLogs/NodeLogsTab';
import { PodsTab } from '@modules/object-panel/components/ObjectPanel/Pods/PodsTab';
import { JobsTab } from '@modules/object-panel/components/ObjectPanel/Jobs/JobsTab';
import type { ObjectPanelPodsState } from '@modules/object-panel/components/ObjectPanel/hooks/useObjectPanelPods';
import { ErrorBoundary } from '@shared/components/errors/ErrorBoundary';

import type {
  CapabilityReasons,
  CapabilityState,
  ComputedCapabilities,
  PanelObjectData,
  ViewType,
} from '@modules/object-panel/components/ObjectPanel/types';
import type { NodeLogSource } from '@modules/object-panel/components/ObjectPanel/NodeLogs/nodeLogsApi';

const TabErrorFallback = ({ tabName, reset }: { tabName: string; reset: () => void }) => (
  <div className="object-panel-tab-content">
    <div className="object-panel-tab-error">
      <h4>Failed to load {tabName}</h4>
      <p>An error occurred while rendering this tab.</p>
      <button className="button generic" onClick={reset}>
        Retry
      </button>
    </div>
  </div>
);

const EMPTY_CONTAINERS: string[] = [];
const EMPTY_JOBS: types.JobSimpleInfo[] = [];

interface ObjectPanelContentProps {
  activeTab: ViewType;
  detailTabProps: DetailsTabProps | null;
  isPanelOpen: boolean;
  capabilities: ComputedCapabilities;
  capabilityReasons: CapabilityReasons;
  nodeLogsState: CapabilityState;
  nodeLogSources: NodeLogSource[];
  detailScope: string | null;
  // eventsScope is computed once in getObjectPanelKind and threaded
  // here so this component (full-cleanup lifecycle) and EventsTab
  // (fetch + per-tab enable/disable) consume the same string. Used to
  // be computed independently in two places, which created a drift bug.
  eventsScope: string | null;
  // containerLogsScope follows the same pattern as eventsScope: one source of
  // truth in getObjectPanelKind, consumed by this component (cleanup)
  // and LogViewer (actual streaming). They used to duplicate the
  // string builder and could drift apart on kind casing.
  containerLogsScope: string | null;
  // mapScope mirrors eventsScope/containerLogsScope: computed once in
  // getObjectPanelKind and threaded into both this component (cleanup)
  // and MapTab (fetch + per-tab enable/disable) so they cannot drift.
  mapScope: string | null;
  helmScope: string | null;
  objectData: PanelObjectData | null;
  objectKind: string | null;
  resourceDeleted: boolean;
  deletedResourceName: string;
  onClosePanel?: () => void;
  onRefreshDetails?: () => void;
  podsState: ObjectPanelPodsState;
  /**
   * Stable identifier for the owning ObjectPanel. Threaded down to
   * LogViewer so it can key its prefs cache by panel — see
   * logViewerPrefsCache.ts. Required for cluster-switch round-trips
   * to restore autoScroll/textFilter/parsed view/etc.
   */
  panelId: string;
}

export function ObjectPanelContent({
  activeTab,
  detailTabProps,
  isPanelOpen,
  capabilities,
  capabilityReasons,
  nodeLogsState,
  nodeLogSources,
  detailScope,
  eventsScope,
  containerLogsScope,
  mapScope,
  helmScope,
  objectData,
  objectKind,
  resourceDeleted,
  deletedResourceName,
  onClosePanel,
  podsState,
  panelId,
}: ObjectPanelContentProps) {
  const showDetails = activeTab === 'details' && detailTabProps;
  const showLogs = activeTab === 'logs' && capabilities.hasObjPanelLogs && objectData;
  const showShell = activeTab === 'shell' && capabilities.hasShell && objectData;
  const showPods = activeTab === 'pods';
  const showJobs = activeTab === 'jobs';
  const showEvents = activeTab === 'events';
  const showYaml = activeTab === 'yaml';
  const showMap = activeTab === 'map';
  const showManifest = activeTab === 'manifest';
  const showValues = activeTab === 'values';

  // eventsScope and containerLogsScope are produced upstream by getObjectPanelKind
  // and threaded in via props so the lifecycle effects below and the
  // tabs that consume them (EventsTab, LogViewer) cannot disagree.

  // --- Scoped domain lifecycle for object panel tabs ---
  // On unmount we stop refreshing/streaming each scope but preserve its
  // cached snapshot via { preserveState: true }. That way a remount caused
  // by a cluster switch (or any other transient unmount) reads cached
  // entries instantly and the user sees content without a reload spinner
  // while the next refresh/stream catches up. The cache is only fully
  // evicted when the user closes the panel — see
  // ObjectPanelStateContext.closePanel.

  // object-events
  useEffect(() => {
    if (!eventsScope || !isPanelOpen) {
      return;
    }
    return () => {
      refreshOrchestrator.setScopedDomainEnabled('object-events', eventsScope, false, {
        preserveState: true,
      });
    };
  }, [eventsScope, isPanelOpen]);

  // object-yaml
  useEffect(() => {
    if (!detailScope || !isPanelOpen) {
      return;
    }
    return () => {
      refreshOrchestrator.setScopedDomainEnabled('object-yaml', detailScope, false, {
        preserveState: true,
      });
    };
  }, [detailScope, isPanelOpen]);

  // object-helm-manifest
  useEffect(() => {
    if (!helmScope || !isPanelOpen) {
      return;
    }
    return () => {
      refreshOrchestrator.setScopedDomainEnabled('object-helm-manifest', helmScope, false, {
        preserveState: true,
      });
    };
  }, [helmScope, isPanelOpen]);

  // object-helm-values
  useEffect(() => {
    if (!helmScope || !isPanelOpen) {
      return;
    }
    return () => {
      refreshOrchestrator.setScopedDomainEnabled('object-helm-values', helmScope, false, {
        preserveState: true,
      });
    };
  }, [helmScope, isPanelOpen]);

  // container-logs — LogViewer manages streaming start/stop. The disable call
  // here stops the underlying stream while keeping the buffered entries in
  // place; on remount the cache renders immediately and a new stream
  // resumes appending fresh entries.
  useEffect(() => {
    if (!containerLogsScope || !isPanelOpen) {
      return;
    }
    return () => {
      refreshOrchestrator.setScopedDomainEnabled('container-logs', containerLogsScope, false, {
        preserveState: true,
      });
    };
  }, [containerLogsScope, isPanelOpen]);

  // object-map — MapTab handles per-tab enable/disable; this guard mirrors
  // the events/yaml pattern so closing the whole panel disables the
  // domain (the eventual reset happens in evictPanelScopes when the
  // panel ref is removed from openPanels).
  useEffect(() => {
    if (!mapScope || !isPanelOpen) {
      return;
    }
    return () => {
      refreshOrchestrator.setScopedDomainEnabled('object-map', mapScope, false, {
        preserveState: true,
      });
    };
  }, [mapScope, isPanelOpen]);

  const activePodNames = detailTabProps?.detailModel.activePodNames ?? null;
  const availableContainers = detailTabProps?.detailModel.availableContainers ?? EMPTY_CONTAINERS;
  const cronJobDetails = detailTabProps?.detailModel.slots.cronJobDetails ?? null;

  if (resourceDeleted) {
    return (
      <div className="object-panel-content">
        <div className="object-panel-empty-state">
          <h3>Object not found</h3>
          <p>{deletedResourceName || 'Resource'} is no longer available.</p>
          {onClosePanel && (
            <div>
              <button type="button" className="button generic" onClick={onClosePanel}>
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="object-panel-content">
      {showDetails && (
        <ErrorBoundary
          scope="panel-details"
          resetKeys={detailScope ? [detailScope] : undefined}
          fallback={(_, reset) => <TabErrorFallback tabName="Details" reset={reset} />}
        >
          <DetailsTab {...detailTabProps!} />
        </ErrorBoundary>
      )}

      {showLogs && objectKind !== 'node' && (
        <ErrorBoundary
          scope="panel-logs"
          resetKeys={[objectData?.name ?? '', objectData?.namespace ?? ''].filter(Boolean)}
          fallback={(_, reset) => <TabErrorFallback tabName="Logs" reset={reset} />}
        >
          <LogViewer
            namespace={objectData?.namespace || ''}
            isActive={isPanelOpen && activeTab === 'logs'}
            resourceName={objectData?.name || ''}
            resourceKind={objectKind || 'pod'}
            containerLogsScope={containerLogsScope}
            activePodNames={activePodNames}
            clusterId={objectData?.clusterId ?? null}
            panelId={panelId}
          />
        </ErrorBoundary>
      )}

      {showShell && (
        <ErrorBoundary
          scope="panel-shell"
          resetKeys={[objectData?.name ?? '', objectData?.namespace ?? ''].filter(Boolean)}
          fallback={(_, reset) => <TabErrorFallback tabName="Shell" reset={reset} />}
        >
          <ShellTab
            namespace={objectData?.namespace || ''}
            resourceName={objectData?.name || ''}
            isActive={isPanelOpen && activeTab === 'shell'}
            disabledReason={capabilityReasons.shell}
            debugDisabledReason={capabilityReasons.debug}
            availableContainers={availableContainers}
            clusterId={objectData?.clusterId ?? null}
          />
        </ErrorBoundary>
      )}

      {showLogs && objectKind === 'node' && (
        <ErrorBoundary
          scope="panel-node-logs"
          resetKeys={[objectData?.name ?? '', objectData?.clusterId ?? ''].filter(Boolean)}
          fallback={(_, reset) => <TabErrorFallback tabName="Logs" reset={reset} />}
        >
          <NodeLogsTab
            panelId={panelId}
            nodeName={objectData?.name || ''}
            clusterId={objectData?.clusterId ?? null}
            isActive={isPanelOpen && activeTab === 'logs'}
            availability={nodeLogsState}
            sources={nodeLogSources}
          />
        </ErrorBoundary>
      )}

      {showEvents && (
        <ErrorBoundary
          scope="panel-events"
          resetKeys={[objectData?.name ?? '', objectData?.namespace ?? ''].filter(Boolean)}
          fallback={(_, reset) => <TabErrorFallback tabName="Events" reset={reset} />}
        >
          <EventsTab
            objectData={objectData}
            isActive={isPanelOpen && activeTab === 'events'}
            eventsScope={eventsScope}
          />
        </ErrorBoundary>
      )}

      {showPods && (
        <ErrorBoundary
          scope="panel-pods"
          resetKeys={[objectData?.name ?? '', objectData?.namespace ?? ''].filter(Boolean)}
          fallback={(_, reset) => <TabErrorFallback tabName="Pods" reset={reset} />}
        >
          <PodsTab
            pods={podsState.pods}
            metrics={podsState.metrics}
            loading={podsState.loading}
            error={podsState.error}
            isActive={isPanelOpen && activeTab === 'pods'}
          />
        </ErrorBoundary>
      )}

      {showJobs && (
        <ErrorBoundary
          scope="panel-jobs"
          resetKeys={[objectData?.name ?? '', objectData?.namespace ?? ''].filter(Boolean)}
          fallback={(_, reset) => <TabErrorFallback tabName="Jobs" reset={reset} />}
        >
          <JobsTab
            jobs={cronJobDetails?.jobs ?? EMPTY_JOBS}
            loading={!cronJobDetails && !!detailTabProps?.detailsLoading}
            isActive={isPanelOpen && activeTab === 'jobs'}
            clusterId={objectData?.clusterId}
            clusterName={objectData?.clusterName}
          />
        </ErrorBoundary>
      )}

      {showYaml && (
        <ErrorBoundary
          scope="panel-yaml"
          resetKeys={detailScope ? [detailScope] : undefined}
          fallback={(_, reset) => <TabErrorFallback tabName="YAML" reset={reset} />}
        >
          <YamlTab
            scope={detailScope}
            isActive={isPanelOpen && activeTab === 'yaml'}
            canEdit={capabilities.canEditYaml}
            editDisabledReason={capabilityReasons.editYaml}
            clusterId={objectData?.clusterId ?? null}
          />
        </ErrorBoundary>
      )}

      {showMap && (
        <ErrorBoundary
          scope="panel-map"
          resetKeys={mapScope ? [mapScope] : undefined}
          fallback={(_, reset) => <TabErrorFallback tabName="Map" reset={reset} />}
        >
          <MapTab
            objectData={objectData}
            isActive={isPanelOpen && activeTab === 'map'}
            mapScope={mapScope}
          />
        </ErrorBoundary>
      )}

      {showManifest && (
        <ErrorBoundary
          scope="panel-manifest"
          resetKeys={helmScope ? [helmScope] : undefined}
          fallback={(_, reset) => <TabErrorFallback tabName="Manifest" reset={reset} />}
        >
          <ManifestTab scope={helmScope} isActive={isPanelOpen && activeTab === 'manifest'} />
        </ErrorBoundary>
      )}

      {showValues && (
        <ErrorBoundary
          scope="panel-values"
          resetKeys={helmScope ? [helmScope] : undefined}
          fallback={(_, reset) => <TabErrorFallback tabName="Values" reset={reset} />}
        >
          <ValuesTab scope={helmScope} isActive={isPanelOpen && activeTab === 'values'} />
        </ErrorBoundary>
      )}
    </div>
  );
}

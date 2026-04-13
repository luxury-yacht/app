/**
 * frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelContent.tsx
 *
 * Renders the content of the object panel based on the active tab and provided props.
 * Each tab is conditionally rendered and wrapped in an error boundary for robustness.
 */
import { useEffect, useMemo } from 'react';
import { refreshOrchestrator } from '@/core/refresh';
import DetailsTab from '@modules/object-panel/components/ObjectPanel/Details/DetailsTab';
import type { DetailsTabProps } from '@modules/object-panel/components/ObjectPanel/Details/DetailsTab';
import LogViewer from '@modules/object-panel/components/ObjectPanel/Logs/LogViewer';
import EventsTab from '@modules/object-panel/components/ObjectPanel/Events/EventsTab';
import YamlTab from '@modules/object-panel/components/ObjectPanel/Yaml/YamlTab';
import ManifestTab from '@modules/object-panel/components/ObjectPanel/Helm/ManifestTab';
import ValuesTab from '@modules/object-panel/components/ObjectPanel/Helm/ValuesTab';
import ShellTab from '@modules/object-panel/components/ObjectPanel/Shell/ShellTab';
import NodeLogsTab from '@modules/object-panel/components/ObjectPanel/NodeLogs/NodeLogsTab';
import { NodeMaintenanceTab } from '@modules/object-panel/components/ObjectPanel/Maintenance/NodeMaintenanceTab';
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
  // logScope follows the same pattern as eventsScope: one source of
  // truth in getObjectPanelKind, consumed by this component (cleanup)
  // and LogViewer (actual streaming). They used to duplicate the
  // string builder and could drift apart on kind casing.
  logScope: string | null;
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
  logScope,
  helmScope,
  objectData,
  objectKind,
  resourceDeleted,
  deletedResourceName,
  onClosePanel,
  onRefreshDetails,
  podsState,
  panelId,
}: ObjectPanelContentProps) {
  const showDetails = activeTab === 'details' && detailTabProps;
  const showLogs = activeTab === 'logs' && capabilities.hasLogs && objectData;
  const showShell = activeTab === 'shell' && capabilities.hasShell && objectData;
  const showPods = activeTab === 'pods';
  const showJobs = activeTab === 'jobs';
  const showEvents = activeTab === 'events';
  const showYaml = activeTab === 'yaml';
  const showManifest = activeTab === 'manifest';
  const showValues = activeTab === 'values';
  const showMaintenance = activeTab === 'maintenance' && objectKind === 'node';

  // eventsScope and logScope are produced upstream by getObjectPanelKind
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

  // object-logs — LogViewer manages streaming start/stop. The disable call
  // here stops the underlying stream while keeping the buffered entries in
  // place; on remount the cache renders immediately and a new stream
  // resumes appending fresh entries.
  useEffect(() => {
    if (!logScope || !isPanelOpen) {
      return;
    }
    return () => {
      refreshOrchestrator.setScopedDomainEnabled('object-logs', logScope, false, {
        preserveState: true,
      });
    };
  }, [logScope, isPanelOpen]);

  // Derive activePodNames from the nested pod arrays directly, not from
  // `detailTabProps` itself. `detailTabProps` is a fresh object literal
  // every render (built inline in ObjectPanel), so using it as a useMemo
  // dep would invalidate the cache on every parent re-render — including
  // every rAF tick of a panel drag/resize. That in turn would rebuild the
  // `activePodNames` array on every frame and cascade re-renders through
  // LogViewer, making the Logs tab janky during drag.
  //
  // The nested `*Details` objects, on the other hand, come from the
  // memoized `detailsProps` in ObjectPanel and are referentially stable
  // until the backend detail payload changes — so their `.pods` arrays
  // are stable drag-safe deps.
  const deploymentPods = detailTabProps?.deploymentDetails?.pods;
  const daemonSetPods = detailTabProps?.daemonSetDetails?.pods;
  const statefulSetPods = detailTabProps?.statefulSetDetails?.pods;
  const jobPods = detailTabProps?.jobDetails?.pods;
  const cronJobPods = detailTabProps?.cronJobDetails?.pods;
  const activePodNames = useMemo(() => {
    if (!detailTabProps) {
      return null;
    }

    const extractPodNames = (pods?: Array<{ name?: string | null }>) => {
      if (!pods || pods.length === 0) {
        return null;
      }
      const names = pods
        .map((pod) => (typeof pod.name === 'string' ? pod.name.trim() : ''))
        .filter((name) => name.length > 0);
      return names.length > 0 ? names : null;
    };

    return (
      extractPodNames(deploymentPods ?? undefined) ??
      extractPodNames(daemonSetPods ?? undefined) ??
      extractPodNames(statefulSetPods ?? undefined) ??
      extractPodNames(jobPods ?? undefined) ??
      extractPodNames(cronJobPods ?? undefined) ??
      null
    );
    // detailTabProps is only read for the null-check above; the actual
    // pod arrays are the useMemo deps so drag-driven re-renders don't
    // invalidate this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deploymentPods, daemonSetPods, statefulSetPods, jobPods, cronJobPods]);

  const availableContainers = useMemo(() => {
    const containers =
      detailTabProps?.podDetails?.containers?.map((container) => container.name?.trim()) ?? [];
    return containers.filter((name): name is string => Boolean(name));
  }, [detailTabProps?.podDetails?.containers]);

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
            logScope={logScope}
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
            jobs={detailTabProps?.cronJobDetails?.jobs ?? []}
            loading={!detailTabProps?.cronJobDetails && !!detailTabProps?.detailsLoading}
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

      {showMaintenance && (
        <ErrorBoundary
          scope="panel-maintenance"
          resetKeys={objectData?.name ? [objectData.name] : undefined}
          fallback={(_, reset) => <TabErrorFallback tabName="Maintenance" reset={reset} />}
        >
          <NodeMaintenanceTab
            nodeDetails={detailTabProps?.nodeDetails ?? null}
            objectName={objectData?.name}
            onRefresh={onRefreshDetails}
            isActive={isPanelOpen && activeTab === 'maintenance'}
            clusterId={objectData?.clusterId ?? null}
          />
        </ErrorBoundary>
      )}
    </div>
  );
}

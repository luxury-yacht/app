/**
 * frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelContent.tsx
 *
 * Renders the content of the object panel based on the active tab and provided props.
 * Each tab is conditionally rendered and wrapped in an error boundary for robustness.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { refreshOrchestrator } from '@/core/refresh';
import DetailsTab from '@modules/object-panel/components/ObjectPanel/Details/DetailsTab';
import type { DetailsTabProps } from '@modules/object-panel/components/ObjectPanel/Details/DetailsTab';
import LogViewer from '@modules/object-panel/components/ObjectPanel/Logs/LogViewer';
import EventsTab from '@modules/object-panel/components/ObjectPanel/Events/EventsTab';
import YamlTab from '@modules/object-panel/components/ObjectPanel/Yaml/YamlTab';
import ManifestTab from '@modules/object-panel/components/ObjectPanel/Helm/ManifestTab';
import ValuesTab from '@modules/object-panel/components/ObjectPanel/Helm/ValuesTab';
import ShellTab from '@modules/object-panel/components/ObjectPanel/Shell/ShellTab';
import { NodeMaintenanceTab } from '@modules/object-panel/components/ObjectPanel/Maintenance/NodeMaintenanceTab';
import { PodsTab } from '@modules/object-panel/components/ObjectPanel/Pods/PodsTab';
import { JobsTab } from '@modules/object-panel/components/ObjectPanel/Jobs/JobsTab';
import type { ObjectPanelPodsState } from '@modules/object-panel/components/ObjectPanel/hooks/useObjectPanelPods';
import { ErrorBoundary } from '@shared/components/errors/ErrorBoundary';

import type {
  CapabilityReasons,
  ComputedCapabilities,
  PanelObjectData,
  ViewType,
} from '@modules/object-panel/components/ObjectPanel/types';

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
}

export function ObjectPanelContent({
  activeTab,
  detailTabProps,
  isPanelOpen,
  capabilities,
  capabilityReasons,
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
  // Managed here (rather than in each tab) so that switching tabs doesn't
  // unmount the component and reset the scoped domain entry. Each tab still
  // controls its own enable/disable via setScopedDomainEnabled, but passes
  // preserveState so the store entry is retained. Full cleanup (reset) only
  // happens here when the panel closes or the scope changes.

  // object-events
  useEffect(() => {
    if (!eventsScope || !isPanelOpen) {
      return;
    }
    return () => {
      refreshOrchestrator.setScopedDomainEnabled('object-events', eventsScope, false);
      refreshOrchestrator.resetScopedDomain('object-events', eventsScope);
    };
  }, [eventsScope, isPanelOpen]);

  // object-yaml
  useEffect(() => {
    if (!detailScope || !isPanelOpen) {
      return;
    }
    return () => {
      refreshOrchestrator.setScopedDomainEnabled('object-yaml', detailScope, false);
      refreshOrchestrator.resetScopedDomain('object-yaml', detailScope);
    };
  }, [detailScope, isPanelOpen]);

  // object-helm-manifest
  useEffect(() => {
    if (!helmScope || !isPanelOpen) {
      return;
    }
    return () => {
      refreshOrchestrator.setScopedDomainEnabled('object-helm-manifest', helmScope, false);
      refreshOrchestrator.resetScopedDomain('object-helm-manifest', helmScope);
    };
  }, [helmScope, isPanelOpen]);

  // object-helm-values
  useEffect(() => {
    if (!helmScope || !isPanelOpen) {
      return;
    }
    return () => {
      refreshOrchestrator.setScopedDomainEnabled('object-helm-values', helmScope, false);
      refreshOrchestrator.resetScopedDomain('object-helm-values', helmScope);
    };
  }, [helmScope, isPanelOpen]);

  // object-logs — LogViewer manages streaming start/stop with preserveState.
  // This effect handles the full cleanup when the panel closes.
  useEffect(() => {
    if (!logScope || !isPanelOpen) {
      return;
    }
    return () => {
      refreshOrchestrator.stopStreamingDomain('object-logs', logScope, { reset: false });
      refreshOrchestrator.setScopedDomainEnabled('object-logs', logScope, false);
      refreshOrchestrator.resetScopedDomain('object-logs', logScope);
    };
  }, [logScope, isPanelOpen]);

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
      extractPodNames(detailTabProps.deploymentDetails?.pods ?? undefined) ??
      extractPodNames(detailTabProps.daemonSetDetails?.pods ?? undefined) ??
      extractPodNames(detailTabProps.statefulSetDetails?.pods ?? undefined) ??
      extractPodNames(detailTabProps.jobDetails?.pods ?? undefined) ??
      extractPodNames(detailTabProps.cronJobDetails?.pods ?? undefined) ??
      null
    );
  }, [detailTabProps]);

  const availableContainers = useMemo(() => {
    const containers =
      detailTabProps?.podDetails?.containers?.map((container) => container.name?.trim()) ?? [];
    return containers.filter((name): name is string => Boolean(name));
  }, [detailTabProps?.podDetails?.containers]);

  // Preserve parsed view preference across LogViewer unmount/remount (tab switches).
  // The ref survives because ObjectPanelContent stays mounted while the panel is open.
  const parsedViewRef = useRef(false);
  const handleParsedViewChange = useCallback((isParsed: boolean) => {
    parsedViewRef.current = isParsed;
  }, []);

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

      {showLogs && (
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
            initialParsedView={parsedViewRef.current}
            onParsedViewChange={handleParsedViewChange}
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

/**
 * frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelContent.tsx
 *
 * Routes the active object-panel tab to its concrete tab component and owns
 * tab-level cleanup for scoped refresh domains that should pause and preserve
 * cached state when panel content is torn down.
 */
import { useMemo } from 'react';
import type { types } from '@wailsjs/go/models';
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
import {
  useObjectPanelScopedDomainCleanups,
  type ObjectPanelScopedDomainRef,
} from '@modules/object-panel/components/ObjectPanel/hooks/useObjectPanelScopedDomainLifecycle';
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
  // eventsScope is computed once in getObjectPanelScopes and threaded
  // here so this component (full-cleanup lifecycle) and EventsTab
  // (fetch + per-tab enable/disable) consume the same string. Used to
  // be computed independently in two places, which created a drift bug.
  eventsScope: string | null;
  // containerLogsScope follows the same pattern as eventsScope: one source of
  // truth in getObjectPanelScopes, consumed by this component (cleanup)
  // and LogViewer (actual streaming). They used to duplicate the
  // string builder and could drift apart on kind casing.
  containerLogsScope: string | null;
  // mapScope mirrors eventsScope/containerLogsScope: computed once in
  // getObjectPanelScopes and threaded into both this component (cleanup)
  // and MapTab (fetch + per-tab enable/disable) so they cannot drift.
  mapScope: string | null;
  helmScope: string | null;
  objectData: PanelObjectData | null;
  objectKind: string | null;
  resourceDeleted: boolean;
  deletedResourceName: string;
  onClosePanel?: () => void;
  onRefreshDetails?: () => void;
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

  const scopedDomainCleanups = useMemo<readonly ObjectPanelScopedDomainRef[]>(
    () => [
      { domain: 'object-events', scope: eventsScope },
      { domain: 'object-yaml', scope: detailScope },
      { domain: 'object-helm-manifest', scope: helmScope },
      { domain: 'object-helm-values', scope: helmScope },
      { domain: 'container-logs', scope: containerLogsScope },
      { domain: 'object-map', scope: mapScope },
    ],
    [containerLogsScope, detailScope, eventsScope, helmScope, mapScope]
  );

  // Stops panel-owned scoped refresh domains during transient unmounts while
  // preserving cached snapshots. Full eviction still belongs to panel close.
  useObjectPanelScopedDomainCleanups(scopedDomainCleanups, isPanelOpen);

  const activePodNames = detailTabProps?.detailModel.activePodNames ?? null;
  const availableContainers = detailTabProps?.detailModel.availableContainers ?? EMPTY_CONTAINERS;
  // For a CronJob the active detail DTO carries the child jobs (for the Jobs timeline tab).
  const cronJobDetails =
    detailTabProps?.detailModel.objectKind === 'cronjob'
      ? (detailTabProps.detailModel.activeDetail as { jobs?: types.JobSimpleInfo[] } | null)
      : null;

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
            panelId={panelId}
          />
        </ErrorBoundary>
      )}

      {showPods && (
        <ErrorBoundary
          scope="panel-pods"
          resetKeys={[objectData?.name ?? '', objectData?.namespace ?? ''].filter(Boolean)}
          fallback={(_, reset) => <TabErrorFallback tabName="Pods" reset={reset} />}
        >
          <PodsTab isActive={isPanelOpen && activeTab === 'pods'} />
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

/**
 * frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelContent.tsx
 *
 * Routes the active object-panel tab to its concrete tab component and owns
 * tab-level cleanup for scoped refresh domains that should pause and preserve
 * cached state when panel content is torn down.
 */

import type { types } from '@core/backend-api/models';
import type { DetailsTabProps } from '@modules/object-panel/components/ObjectPanel/Details/DetailsTab';
import {
  type ObjectPanelScopedDomainRef,
  useObjectPanelScopedDomainCleanups,
} from '@modules/object-panel/components/ObjectPanel/hooks/useObjectPanelScopedDomainLifecycle';
import type { NodeLogSource } from '@modules/object-panel/components/ObjectPanel/NodeLogs/nodeLogsApi';
import type {
  CapabilityReasons,
  CapabilityState,
  ComputedCapabilities,
  PanelObjectData,
  ViewType,
} from '@modules/object-panel/components/ObjectPanel/types';
import { loadObjectPanelDetails } from '@modules/object-panel/objectPanelDetailsLazyModule';
import { ErrorBoundary } from '@shared/components/errors/ErrorBoundary';
import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import React, { lazy, type ReactNode, useMemo } from 'react';

const DetailsTab = lazy(loadObjectPanelDetails);
const EventsTab = lazy(
  () => import('@modules/object-panel/components/ObjectPanel/Events/EventsTab')
);
const ManifestTab = lazy(
  () => import('@modules/object-panel/components/ObjectPanel/Helm/ManifestTab')
);
const ValuesTab = lazy(() => import('@modules/object-panel/components/ObjectPanel/Helm/ValuesTab'));
const JobsTab = lazy(() =>
  import('@modules/object-panel/components/ObjectPanel/Jobs/JobsTab').then((module) => ({
    default: module.JobsTab,
  }))
);
const LogViewer = lazy(() => import('@modules/object-panel/components/ObjectPanel/Logs/LogViewer'));
const MapTab = lazy(() => import('@modules/object-panel/components/ObjectPanel/Map/MapTab'));
const NodeLogsTab = lazy(
  () => import('@modules/object-panel/components/ObjectPanel/NodeLogs/NodeLogsTab')
);
const PodsTab = lazy(() =>
  import('@modules/object-panel/components/ObjectPanel/Pods/PodsTab').then((module) => ({
    default: module.PodsTab,
  }))
);
const ShellTab = lazy(() => import('@modules/object-panel/components/ObjectPanel/Shell/ShellTab'));
const YamlTab = lazy(() => import('@modules/object-panel/components/ObjectPanel/Yaml/YamlTab'));

const createTabErrorFallback = (tabName: string) => (_error: Error, reset: () => void) => (
  <TabErrorFallback tabName={tabName} reset={reset} />
);

// Tab implementations share recovery/loading policy while retaining their own reset keys.
const PanelTabBoundary = ({
  scope,
  resetKeys,
  tabName,
  loadingName,
  children,
}: {
  scope: string;
  resetKeys?: string[];
  tabName: string;
  loadingName: string;
  children: ReactNode;
}) => (
  <ErrorBoundary scope={scope} resetKeys={resetKeys} fallback={createTabErrorFallback(tabName)}>
    <React.Suspense fallback={<LoadingSpinner message={`Loading ${loadingName}...`} />}>
      {children}
    </React.Suspense>
  </ErrorBoundary>
);

const TabErrorFallback = ({ tabName, reset }: { tabName: string; reset: () => void }) => (
  <div className="object-panel-tab-content">
    <div className="object-panel-tab-error">
      <h4>
        Failed to load <ErrorSurface kind="reported" message={tabName} />
      </h4>
      <p>An error occurred while rendering this tab.</p>
      <button type="button" className="button generic" onClick={reset}>
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

interface RetainedLogsTabProps {
  isVisible: boolean;
  isAvailable: boolean;
  isPanelOpen: boolean;
  objectKind: string | null;
  objectData: PanelObjectData | null;
  containerLogsScope: string | null;
  activePodNames: string[] | null;
  panelId: string;
  nodeLogsState: CapabilityState;
  nodeLogSources: NodeLogSource[];
}

const RetainedLogsTab = ({
  isVisible,
  isAvailable,
  isPanelOpen,
  objectKind,
  objectData,
  containerLogsScope,
  activePodNames,
  panelId,
  nodeLogsState,
  nodeLogSources,
}: Readonly<RetainedLogsTabProps>) => {
  const hasRenderedRef = React.useRef(false);
  if (isVisible) {
    hasRenderedRef.current = true;
  }
  if (!hasRenderedRef.current || !isAvailable) {
    return null;
  }

  const isActive = isPanelOpen && isVisible;
  const name = objectData?.name ?? '';
  const namespace = objectData?.namespace ?? '';
  const clusterId = objectData?.clusterId ?? null;
  return (
    <div
      className={`object-panel-retained-tab${isVisible ? '' : ' object-panel-retained-tab--inactive'}`}
      aria-hidden={!isVisible}
      inert={!isVisible}
    >
      {objectKind !== 'node' ? (
        <PanelTabBoundary
          scope="panel-logs"
          resetKeys={[name, namespace].filter(Boolean)}
          tabName="Logs"
          loadingName="logs"
        >
          <LogViewer
            isActive={isActive}
            resourceKind={objectKind || 'pod'}
            containerLogsScope={containerLogsScope}
            activePodNames={activePodNames}
            clusterId={clusterId}
            panelId={panelId}
          />
        </PanelTabBoundary>
      ) : (
        <PanelTabBoundary
          scope="panel-node-logs"
          resetKeys={[name, clusterId ?? ''].filter(Boolean)}
          tabName="Logs"
          loadingName="logs"
        >
          <NodeLogsTab
            panelId={panelId}
            nodeName={name}
            clusterId={clusterId}
            isActive={isActive}
            availability={nodeLogsState}
            sources={nodeLogSources}
          />
        </PanelTabBoundary>
      )}
    </div>
  );
};

// Transient tabs unmount when their selection changes. Logs and YAML have separate
// retention owners below; they must never be routed through this table.
const transientTabs = new Map<ViewType, React.ComponentType<ObjectPanelContentProps>>([
  [
    'details',
    ({ detailTabProps, detailScope }) => {
      if (!detailTabProps) {
        return null;
      }
      return (
        <PanelTabBoundary
          scope="panel-details"
          resetKeys={detailScope ? [detailScope] : undefined}
          tabName="Details"
          loadingName="details"
        >
          <DetailsTab {...detailTabProps} />
        </PanelTabBoundary>
      );
    },
  ],
  [
    'shell',
    ({ capabilities, objectData, detailTabProps, isPanelOpen, capabilityReasons }) => {
      if (!capabilities.hasShell || !objectData) {
        return null;
      }
      const availableContainers =
        detailTabProps?.detailModel.availableContainers ?? EMPTY_CONTAINERS;
      return (
        <PanelTabBoundary
          scope="panel-shell"
          resetKeys={[objectData?.name ?? '', objectData?.namespace ?? ''].filter(Boolean)}
          tabName="Shell"
          loadingName="shell"
        >
          <ShellTab
            namespace={objectData?.namespace || ''}
            resourceName={objectData?.name || ''}
            isActive={isPanelOpen}
            disabledReason={capabilityReasons.shell}
            debugDisabledReason={capabilityReasons.debug}
            availableContainers={availableContainers}
            clusterId={objectData?.clusterId ?? null}
          />
        </PanelTabBoundary>
      );
    },
  ],
  [
    'events',
    ({ objectData, isPanelOpen, eventsScope, panelId }) => {
      return (
        <PanelTabBoundary
          scope="panel-events"
          resetKeys={[objectData?.name ?? '', objectData?.namespace ?? ''].filter(Boolean)}
          tabName="Events"
          loadingName="events"
        >
          <EventsTab
            objectData={objectData}
            isActive={isPanelOpen}
            eventsScope={eventsScope}
            panelId={panelId}
          />
        </PanelTabBoundary>
      );
    },
  ],
  [
    'pods',
    ({ objectData, isPanelOpen }) => {
      return (
        <PanelTabBoundary
          scope="panel-pods"
          resetKeys={[objectData?.name ?? '', objectData?.namespace ?? ''].filter(Boolean)}
          tabName="Pods"
          loadingName="pods"
        >
          <PodsTab isActive={isPanelOpen} />
        </PanelTabBoundary>
      );
    },
  ],
  [
    'jobs',
    ({ objectData, isPanelOpen, detailTabProps }) => {
      const cronJobDetails =
        detailTabProps?.detailModel.objectKind === 'cronjob'
          ? (detailTabProps.detailModel.activeDetail as { jobs?: types.JobSimpleInfo[] } | null)
          : null;
      return (
        <PanelTabBoundary
          scope="panel-jobs"
          resetKeys={[objectData?.name ?? '', objectData?.namespace ?? ''].filter(Boolean)}
          tabName="Jobs"
          loadingName="jobs"
        >
          <JobsTab
            jobs={cronJobDetails?.jobs ?? EMPTY_JOBS}
            loading={!cronJobDetails && !!detailTabProps?.detailsLoading}
            isActive={isPanelOpen}
            clusterId={objectData?.clusterId}
            clusterName={objectData?.clusterName}
          />
        </PanelTabBoundary>
      );
    },
  ],
  [
    'map',
    ({ mapScope, objectData, isPanelOpen }) => {
      return (
        <PanelTabBoundary
          scope="panel-map"
          resetKeys={mapScope ? [mapScope] : undefined}
          tabName="Map"
          loadingName="map"
        >
          <MapTab objectData={objectData} isActive={isPanelOpen} mapScope={mapScope} />
        </PanelTabBoundary>
      );
    },
  ],
  [
    'manifest',
    ({ helmScope, isPanelOpen }) => {
      return (
        <PanelTabBoundary
          scope="panel-manifest"
          resetKeys={helmScope ? [helmScope] : undefined}
          tabName="Manifest"
          loadingName="manifest"
        >
          <ManifestTab scope={helmScope} isActive={isPanelOpen} />
        </PanelTabBoundary>
      );
    },
  ],
  [
    'values',
    ({ helmScope, isPanelOpen }) => {
      return (
        <PanelTabBoundary
          scope="panel-values"
          resetKeys={helmScope ? [helmScope] : undefined}
          tabName="Values"
          loadingName="values"
        >
          <ValuesTab scope={helmScope} isActive={isPanelOpen} />
        </PanelTabBoundary>
      );
    },
  ],
]);

export function ObjectPanelContent(props: Readonly<ObjectPanelContentProps>) {
  const {
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
  } = props;
  const logsAvailable = capabilities.hasObjPanelLogs && objectData !== null;
  const showYaml = activeTab === 'yaml';
  const hasRenderedYamlRef = React.useRef(false);
  if (showYaml) {
    hasRenderedYamlRef.current = true;
  }
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
  // Transient unmounts retain snapshots; committed panel removal owns full eviction.
  useObjectPanelScopedDomainCleanups(scopedDomainCleanups, isPanelOpen);
  if (resourceDeleted) {
    return <DeletedObjectContent name={deletedResourceName} onClose={onClosePanel} />;
  }
  const ActiveTab = transientTabs.get(activeTab);
  return (
    <div className="object-panel-content">
      {!!ActiveTab && <ActiveTab key={activeTab} {...props} />}
      <RetainedLogsTab
        isVisible={activeTab === 'logs' && logsAvailable}
        isAvailable={logsAvailable}
        isPanelOpen={isPanelOpen}
        objectKind={objectKind}
        objectData={objectData}
        containerLogsScope={containerLogsScope}
        activePodNames={detailTabProps?.detailModel.activePodNames ?? null}
        panelId={panelId}
        nodeLogsState={nodeLogsState}
        nodeLogSources={nodeLogSources}
      />
      {!!hasRenderedYamlRef.current && (
        <div
          className={`object-panel-retained-tab${showYaml ? '' : ' object-panel-retained-tab--inactive'}`}
          aria-hidden={!showYaml}
          inert={!showYaml}
        >
          <PanelTabBoundary
            scope="panel-yaml"
            resetKeys={detailScope ? [detailScope] : undefined}
            tabName="YAML"
            loadingName="YAML"
          >
            <YamlTab
              scope={detailScope}
              isActive={isPanelOpen && showYaml}
              canEdit={capabilities.canEditYaml}
              editDisabledReason={capabilityReasons.editYaml}
              clusterId={objectData?.clusterId ?? null}
            />
          </PanelTabBoundary>
        </div>
      )}
    </div>
  );
}

const DeletedObjectContent = ({ name, onClose }: { name: string; onClose?: () => void }) => (
  <div className="object-panel-content">
    <div className="object-panel-empty-state">
      <h3>Object not found</h3>
      <p>{name || 'Resource'} is no longer available.</p>
      {!!onClose && (
        <div>
          <button type="button" className="button generic" onClick={onClose}>
            Close
          </button>
        </div>
      )}
    </div>
  </div>
);

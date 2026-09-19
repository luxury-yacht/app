/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Events/EventsTab.tsx
 *
 * Renders object-scoped Kubernetes events in the object panel, backed by the
 * shared events refresh scope computed by ObjectPanel.
 */

import { useTableSort } from '@hooks/useTableSort';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { boundedRowsSource } from '@modules/resource-grid/boundedRowsSource';
import { useResourceInventoryTable } from '@modules/resource-grid/useResourceInventoryTable';
import ClusterDataPausedState from '@shared/components/ClusterDataPausedState';
import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import { formatLiveAgeText, LiveAgeText } from '@shared/components/LiveAgeText';
import {
  type ColumnSizingMap,
  createTextColumn,
  withColumnSizing,
} from '@shared/components/tables/columnFactories';
import GridTable, { type GridColumnDefinition } from '@shared/components/tables/GridTable';
import { buildClusterScopedKey } from '@shared/components/tables/GridTable.utils';
import { createEventTypeColumn } from '@shared/events/eventColumns';
import {
  eventGridRelatedObjectInput,
  objectPanelEventGridRow,
} from '@shared/events/eventGridModel';
import { EVENT_LABELS } from '@shared/events/eventPresentation';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import {
  buildEventObjectReference,
  canResolveEventObjectReference,
  resolveEventObjectReference,
  splitEventObjectTarget,
} from '@shared/utils/eventObjectIdentity';
import { formatAge } from '@utils/ageFormatter';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useClusterNameResolver } from '@/core/cluster-workspace/useClusterWorkspace';
import { type DataRequestReason, requestRefreshDomain } from '@/core/data-access';
import { refreshManager } from '@/core/refresh';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import { useRefreshWatcher } from '@/core/refresh/hooks/useRefreshWatcher';
import { useStreamSignalRefetch } from '@/core/refresh/hooks/useStreamSignalRefetch';
import { applyPassiveLoadingPolicy } from '@/core/refresh/loadingPolicy';
import { useRefreshScopedDomain } from '@/core/refresh/store';
import type { ObjectEventSummary } from '@/core/refresh/types';
import { errorHandler } from '@/utils/errorHandler';
import { CLUSTER_SCOPE, getObjectEventsRefresherName, INACTIVE_SCOPE } from '../constants';
import { useObjectPanelScopedDomainLifecycle } from '../hooks/useObjectPanelScopedDomainLifecycle';
import type { PanelObjectData } from '../types';
import './EventsTab.css';

interface EventsTabProps {
  objectData?: PanelObjectData | null;
  isActive?: boolean;
  // Refresh-domain scope string for the object-events provider. Owned
  // by ObjectPanel via getObjectPanelScopes so EventsTab and
  // ObjectPanelContent (which handles full-cleanup on panel close)
  // cannot drift apart on the same scope key.
  eventsScope: string | null;
  // The panel's canonical identity (objectPanelId), scoping the events
  // refresher name to THIS panel so simultaneously-open same-kind panels
  // register distinct refreshers (see getObjectEventsRefresherName).
  panelId: string | null;
}

function normalizeEventSource(source: ObjectEventSummary['source'] | undefined): string {
  return source?.trim() || 'Unknown';
}

interface EventDisplay {
  type: string;
  source: string;
  reason: string;
  message: string;
  age: string;
  ageTimestamp: Date;
  lastTime: Date;
  objectKind: string;
  objectName: string;
  objectNamespace: string;
  objectUid?: string;
  objectApiVersion?: string;
  involvedObject?: ObjectEventSummary['involvedObject'];
  // Per-event cluster identity from ObjectEventSummary (extends ClusterMeta).
  clusterId?: string;
  clusterName?: string;
}

const EventsTab: React.FC<EventsTabProps> = ({ objectData, isActive, eventsScope, panelId }) => {
  const { isPaused, isManualRefreshActive } = useAutoRefreshLoadingState();
  const { openWithObject } = useObjectPanel();
  const { available: navigationAvailable, navigateToView } = useNavigateToView();
  const resolveClusterName = useClusterNameResolver();
  const openWithObjectRef = useRef(openWithObject);
  useEffect(() => {
    openWithObjectRef.current = openWithObject;
  }, [openWithObject]);

  const eventsSnapshot = useRefreshScopedDomain('object-events', eventsScope ?? INACTIVE_SCOPE);

  useObjectPanelScopedDomainLifecycle({
    domain: 'object-events',
    scope: eventsScope,
    enabled: Boolean(isActive && objectData),
  });

  // The per-object events doorbell only advances the scoped event clock; the
  // poll that used to refresh this scope skips while the stream is healthy.
  // Without this refetch-on-signal the tab freezes at its first load.
  const eventSignalScopes = useMemo(
    () => (isActive && eventsScope ? [eventsScope] : []),
    [isActive, eventsScope]
  );
  useStreamSignalRefetch('object-events', eventSignalScopes);

  const fetchEvents = useCallback(
    async (reason: DataRequestReason = 'startup') => {
      if (!eventsScope) {
        return;
      }
      try {
        await requestRefreshDomain({
          domain: 'object-events',
          scope: eventsScope,
          reason,
        });
      } catch (error) {
        errorHandler.handle(error instanceof Error ? error : new Error(String(error)), {
          source: 'object-events-fetch',
        });
      }
    },
    [eventsScope]
  );

  useEffect(() => {
    if (isActive && objectData && eventsScope) {
      void fetchEvents('startup');
    }
  }, [fetchEvents, isActive, objectData, eventsScope]);

  const eventsRefresherName = useMemo(
    () => getObjectEventsRefresherName(objectData?.kind, panelId),
    [objectData?.kind, panelId]
  );

  useEffect(() => {
    if (!eventsRefresherName || !isActive || !objectData) {
      return;
    }
    refreshManager.register({
      name: eventsRefresherName,
      interval: 3000,
      cooldown: 1000,
      timeout: 10,
    });
    return () => {
      refreshManager.unregister(eventsRefresherName);
    };
  }, [eventsRefresherName, isActive, objectData]);

  useRefreshWatcher({
    refresherName: eventsRefresherName,
    onRefresh: useCallback(
      async (isManual: boolean) => {
        await fetchEvents(isManual ? 'user' : 'background');
      },
      [fetchEvents]
    ),
    enabled: Boolean(isActive && objectData && eventsRefresherName && eventsScope),
  });

  const rawEvents = useMemo(() => {
    if (!eventsScope) {
      return [] as ObjectEventSummary[];
    }
    return (eventsSnapshot.data?.events as ObjectEventSummary[]) ?? [];
  }, [eventsScope, eventsSnapshot.data]);

  const buildEventObjectRefInput = useCallback(
    (
      event: Pick<
        EventDisplay,
        | 'objectKind'
        | 'objectName'
        | 'objectNamespace'
        | 'objectUid'
        | 'objectApiVersion'
        | 'involvedObject'
        | 'clusterId'
        | 'clusterName'
      >
    ) =>
      eventGridRelatedObjectInput(
        objectPanelEventGridRow(
          {
            ...event,
            clusterId: event.clusterId ?? objectData?.clusterId,
            clusterName: event.clusterName ?? objectData?.clusterName,
          },
          CLUSTER_SCOPE
        ),
        {
          fallbackKind: objectData?.kind,
          fallbackGroup: objectData?.group,
          fallbackVersion: objectData?.version,
        }
      ),
    [
      objectData?.clusterId,
      objectData?.clusterName,
      objectData?.group,
      objectData?.kind,
      objectData?.version,
    ]
  );

  const projectRelatedObject = useCallback(
    (event: ObjectEventSummary) => {
      const relatedObject = {
        objectKind: event.involvedObjectKind || objectData?.kind || 'Unknown',
        objectName: event.involvedObjectName || objectData?.name || 'Unknown',
        objectNamespace: event.involvedObjectNamespace ?? objectData?.namespace ?? CLUSTER_SCOPE,
        objectUid: event.involvedObjectUid,
        objectApiVersion: event.involvedObjectApiVersion,
        involvedObject: event.involvedObject,
        clusterId: event.ref.clusterId,
        clusterName:
          resolveClusterName(event.ref.clusterId) ??
          (event.ref.clusterId === objectData?.clusterId
            ? (objectData.clusterName ?? undefined)
            : undefined),
      };
      const ref = buildEventObjectReference(buildEventObjectRefInput(relatedObject));
      const parsed = splitEventObjectTarget(
        `${relatedObject.objectKind}/${relatedObject.objectName}`
      );
      return {
        ...relatedObject,
        objectKind: ref?.kind ?? parsed.objectType,
        objectName: ref?.name ?? parsed.objectName,
      };
    },
    [
      buildEventObjectRefInput,
      objectData?.clusterId,
      objectData?.clusterName,
      objectData?.kind,
      objectData?.name,
      objectData?.namespace,
      resolveClusterName,
    ]
  );

  const events = useMemo<EventDisplay[]>(
    () =>
      rawEvents.map((event) => {
        const lastTime = event.lastTimestamp ? new Date(event.lastTimestamp) : new Date();
        const relatedObject = projectRelatedObject(event);
        return {
          type: event.eventType || 'Normal',
          source: normalizeEventSource(event.source),
          reason: event.reason || '',
          message: event.message || '',
          age: formatAge(lastTime),
          ageTimestamp: lastTime,
          lastTime,
          ...relatedObject,
        };
      }),
    [rawEvents, projectRelatedObject]
  );

  const eventsLoadingState = applyPassiveLoadingPolicy({
    loading: eventsScope
      ? !eventsSnapshot.data?.events &&
        (eventsSnapshot.status === 'loading' ||
          eventsSnapshot.status === 'initialising' ||
          eventsSnapshot.status === 'updating')
      : false,
    hasLoaded: Boolean(eventsSnapshot.data?.events),
    hasData: events.length > 0,
    isPaused,
    isManualRefreshActive,
  });
  const eventsLoading = eventsLoadingState.loading;
  const showPausedEventsState = eventsLoadingState.showPausedEmptyState;
  const eventsError = eventsScope ? (eventsSnapshot.error ?? null) : null;

  const keyExtractor = useCallback((item: EventDisplay, index: number) => {
    const namespaceSegment = item.objectNamespace || CLUSTER_SCOPE;
    const identifier = `${namespaceSegment}:${item.objectKind}:${item.objectName}`;
    return buildClusterScopedKey(item, `${identifier}:${item.lastTime.getTime()}:${index}`);
  }, []);

  const canOpenRelatedObject = useCallback(
    (item: EventDisplay) => canResolveEventObjectReference(buildEventObjectRefInput(item)),
    [buildEventObjectRefInput]
  );

  const openRelatedObject = useCallback(
    async (item: EventDisplay) => {
      const ref = await resolveEventObjectReference(buildEventObjectRefInput(item));
      if (ref) {
        openWithObjectRef.current(ref);
      }
    },
    [buildEventObjectRefInput]
  );

  const navigateToRelatedObject = useCallback(
    async (item: EventDisplay) => {
      const ref = await resolveEventObjectReference(buildEventObjectRefInput(item));
      if (ref) {
        navigateToView(ref);
      }
    },
    [buildEventObjectRefInput, navigateToView]
  );

  const columns = useMemo<GridColumnDefinition<EventDisplay>[]>(() => {
    const base: GridColumnDefinition<EventDisplay>[] = [
      createEventTypeColumn<EventDisplay>(),
      createTextColumn<EventDisplay>('source', EVENT_LABELS.source, (item) => item.source || '-'),
      // Split the involved object into type/name columns for readability.
      createTextColumn<EventDisplay>(
        'objectType',
        EVENT_LABELS.objectType,
        (item) => item.objectKind || '-'
      ),
      createTextColumn<EventDisplay>(
        'objectName',
        EVENT_LABELS.objectName,
        (item) => item.objectName || '-',
        {
          onClick: (item) => {
            void openRelatedObject(item);
          },
          onAltClick: navigationAvailable
            ? (item) => {
                void navigateToRelatedObject(item);
              }
            : undefined,
          getClassName: () => 'object-panel-link',
          isInteractive: canOpenRelatedObject,
          rowAction: true,
        }
      ),
      createTextColumn<EventDisplay>('reason', EVENT_LABELS.reason, (item) => item.reason || '-'),
      createTextColumn<EventDisplay>(
        'message',
        EVENT_LABELS.message,
        (item) => item.message || '-',
        {
          getClassName: (item) => (item.message ? 'event-message' : undefined),
          getTitle: (item) => (item.message ? item.message : undefined),
        }
      ),
      (() => {
        const column = createTextColumn<EventDisplay>(
          'age',
          EVENT_LABELS.lastSeen,
          (item) => formatLiveAgeText(item.ageTimestamp, Date.now(), item.age),
          {
            getClassName: () => 'age-cell',
          }
        );
        column.render = (item) => (
          <LiveAgeText
            timestamp={item.ageTimestamp}
            fallback={item.age}
            fullDateTitle
            className="age-cell"
            data-gridtable-export-text={formatLiveAgeText(item.ageTimestamp, Date.now(), item.age)}
          />
        );
        column.sortValue = (item) => item.ageTimestamp.getTime();
        return column;
      })(),
    ];

    const sizing: ColumnSizingMap = {
      type: { width: 110, minWidth: 90 },
      source: { width: 180, minWidth: 150, autoWidth: true },
      reason: { width: 160, minWidth: 130, autoWidth: true },
      message: { width: 320, minWidth: 260, autoWidth: true },
      objectType: { width: 160, minWidth: 130, autoWidth: true },
      objectName: { width: 220, minWidth: 180, autoWidth: true },
      age: { width: 100, minWidth: 80 },
    };
    return withColumnSizing(base, sizing);
  }, [canOpenRelatedObject, navigateToRelatedObject, navigationAvailable, openRelatedObject]);

  const { sortedData, sortConfig, handleSort } = useTableSort(events, 'age', 'desc', {
    columns,
  });

  // Object events are a bounded, always-partial (recent-window) Event-resource
  // table. Its display lifecycle runs through the shared controller so the
  // loading / settled-empty / partial decisions are centralized (no view-local
  // display path) and a transiently-empty refresh can never flash "No events
  // found". The bespoke object-panel presentation below is driven by this render
  // state; the no-filter, age-sorted GridTable + useTableSort stay as a
  // presentation-only direct exception — the lifecycle is the controller's.
  const eventsRender = useResourceInventoryTable(
    boundedRowsSource<EventDisplay>({
      rows: sortedData,
      loading: eventsLoading,
      // The object-events domain retains data across refreshes and
      // `eventsLoading` already means "no data AND actively loading", so "not
      // loading" is the settled state. Using it as `loaded` makes the
      // controller derive exactly the panel's existing loading/empty conditions
      // (loading only while fetching; empty only once settled), keeping the
      // paused/error ordering and appearance unchanged.
      loaded: !eventsLoading,
      error: eventsError,
      mode: 'Local Partial',
    })
  );

  if (eventsRender.showLoadingBoundary) {
    return (
      <div className="object-panel-tab-content">
        <div className="object-panel-placeholder">
          <p>Loading events...</p>
        </div>
      </div>
    );
  }

  if (showPausedEventsState) {
    return (
      <div className="object-panel-tab-content">
        <div className="object-panel-placeholder">
          <ClusterDataPausedState />
        </div>
      </div>
    );
  }

  if (eventsRender.error) {
    return (
      <div className="object-panel-tab-content">
        <div className="object-panel-placeholder error">
          <p>
            Error loading events: <ErrorSurface kind="reported" message={eventsRender.error} />
          </p>
        </div>
      </div>
    );
  }

  if (eventsRender.isEmpty) {
    return (
      <div className="object-panel-tab-content">
        <div className="object-panel-placeholder">
          <p>No events found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="object-panel-tab-content">
      <div className="events-display">
        <GridTable<EventDisplay>
          data={eventsRender.rows}
          columns={columns}
          emptyMessage="No events"
          sortConfig={sortConfig}
          onSort={handleSort}
          onRowClick={(item) => {
            void openRelatedObject(item);
          }}
          keyExtractor={keyExtractor}
          className="gridtable-object-events"
        />
      </div>
    </div>
  );
};

export default EventsTab;

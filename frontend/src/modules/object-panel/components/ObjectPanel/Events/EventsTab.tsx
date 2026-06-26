/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Events/EventsTab.tsx
 *
 * Renders object-scoped Kubernetes events in the object panel, backed by the
 * shared events refresh scope computed by ObjectPanel.
 */

import React, { useEffect, useCallback, useMemo, useRef } from 'react';
import ClusterDataPausedState from '@shared/components/ClusterDataPausedState';
import GridTable, { type GridColumnDefinition } from '@shared/components/tables/GridTable';
import { buildClusterScopedKey } from '@shared/components/tables/GridTable.utils';
import {
  applyColumnSizing,
  type ColumnSizingMap,
  createTextColumn,
} from '@shared/components/tables/columnFactories';
import { useTableSort } from '@hooks/useTableSort';
import { formatAge } from '@utils/ageFormatter';
import { formatLiveAgeText, LiveAgeText } from '@shared/components/LiveAgeText';
import { errorHandler } from '@/utils/errorHandler';
import { buildLocalPartialDataLabel } from '@modules/resource-grid/tablePartialState';
import { boundedRowsSource } from '@modules/resource-grid/boundedRowsSource';
import { useResourceInventoryTable } from '@modules/resource-grid/useResourceInventoryTable';
import { requestRefreshDomain, type DataRequestReason } from '@/core/data-access';
import type { ObjectEventSummary } from '@/core/refresh/types';
import { refreshManager } from '@/core/refresh';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import { applyPassiveLoadingPolicy } from '@/core/refresh/loadingPolicy';
import { useRefreshScopedDomain } from '@/core/refresh/store';
import { useRefreshWatcher } from '@/core/refresh/hooks/useRefreshWatcher';
import type { ObjectEventsRefresherName } from '@/core/refresh/refresherTypes';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import {
  buildEventObjectReference,
  splitEventObjectTarget,
} from '@shared/utils/eventObjectIdentity';
import {
  eventGridCanOpenRelatedObject,
  eventGridRelatedObjectInput,
  objectPanelEventGridRow,
  resolveEventGridRelatedObject,
} from '@shared/events/eventGridModel';
import type { ResolvedObjectReference } from '@shared/utils/objectIdentity';
import type { PanelObjectData } from '../types';
import { CLUSTER_SCOPE, INACTIVE_SCOPE } from '../constants';
import { useObjectPanelScopedDomainLifecycle } from '../hooks/useObjectPanelScopedDomainLifecycle';
import './EventsTab.css';

interface EventsTabProps {
  objectData?: PanelObjectData | null;
  isActive?: boolean;
  // Refresh-domain scope string for the object-events provider. Owned
  // by ObjectPanel via getObjectPanelScopes so EventsTab and
  // ObjectPanelContent (which handles full-cleanup on panel close)
  // cannot drift apart on the same scope key.
  eventsScope: string | null;
}

function normalizeEventSource(source: ObjectEventSummary['source'] | undefined): string {
  if (typeof source === 'string') {
    return source.trim() || 'Unknown';
  }
  if (!source) {
    return 'Unknown';
  }
  if (source.component) {
    return source.host ? `${source.component} on ${source.host}` : source.component;
  }
  if (source.reportingController) {
    return source.reportingInstance
      ? `${source.reportingController} (${source.reportingInstance})`
      : source.reportingController;
  }
  return 'Unknown';
}

interface EventDisplay {
  type: string;
  source: string;
  reason: string;
  message: string;
  age: string;
  ageTimestamp: Date;
  firstTime: Date;
  lastTime: Date;
  objectKind: string;
  objectName: string;
  objectNamespace: string;
  objectUid?: string;
  objectApiVersion?: string;
  involvedObject?: ObjectEventSummary['involvedObject'];
  objectRef?: ResolvedObjectReference;
  // Per-event cluster identity from ObjectEventSummary (extends ClusterMeta).
  clusterId?: string;
  clusterName?: string;
}

const EventsTab: React.FC<EventsTabProps> = ({ objectData, isActive, eventsScope }) => {
  const { isPaused, isManualRefreshActive } = useAutoRefreshLoadingState();
  const { openWithObject } = useObjectPanel();
  const { navigateToView } = useNavigateToView();
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
    () =>
      objectData?.kind
        ? (`object-${objectData.kind.toLowerCase()}-events` as ObjectEventsRefresherName)
        : null,
    [objectData?.kind]
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
    ) => ({
      ...eventGridRelatedObjectInput(
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
    }),
    [
      objectData?.clusterId,
      objectData?.clusterName,
      objectData?.group,
      objectData?.kind,
      objectData?.version,
    ]
  );

  const events = useMemo<EventDisplay[]>(
    () =>
      rawEvents.map((event) => {
        const lastTime = event.lastTimestamp ? new Date(event.lastTimestamp) : new Date();
        const firstTime = event.firstTimestamp ? new Date(event.firstTimestamp) : new Date();
        const fallbackKind = event.involvedObjectKind || objectData?.kind || 'Unknown';
        const fallbackName = event.involvedObjectName || objectData?.name || 'Unknown';
        const objectNamespace =
          event.involvedObjectNamespace ?? objectData?.namespace ?? CLUSTER_SCOPE;
        const objectRef = buildEventObjectReference(
          buildEventObjectRefInput({
            objectKind: fallbackKind,
            objectName: fallbackName,
            objectNamespace,
            objectUid: event.involvedObjectUid,
            objectApiVersion: event.involvedObjectApiVersion,
            involvedObject: event.involvedObject,
            clusterId: event.clusterId,
            clusterName: event.clusterName,
          })
        );
        const parsedObject = splitEventObjectTarget(`${fallbackKind}/${fallbackName}`);
        return {
          type: event.eventType || 'Normal',
          source: normalizeEventSource(event.source),
          reason: event.reason || '',
          message: event.message || '',
          age: formatAge(lastTime),
          ageTimestamp: lastTime,
          firstTime,
          lastTime,
          objectKind: objectRef?.kind ?? parsedObject.objectType,
          objectName: objectRef?.name ?? parsedObject.objectName,
          objectNamespace,
          objectUid: event.involvedObjectUid,
          objectApiVersion: event.involvedObjectApiVersion,
          involvedObject: event.involvedObject,
          objectRef,
          clusterId: event.clusterId,
          clusterName: event.clusterName,
        };
      }),
    [buildEventObjectRefInput, rawEvents, objectData?.kind, objectData?.name, objectData?.namespace]
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
    (item: EventDisplay) =>
      eventGridCanOpenRelatedObject(
        objectPanelEventGridRow(
          {
            objectKind: item.objectKind,
            objectName: item.objectName,
            objectNamespace: item.objectNamespace,
            objectUid: item.objectUid,
            objectApiVersion: item.objectApiVersion,
            involvedObject: item.involvedObject,
            clusterId: item.clusterId ?? objectData?.clusterId,
            clusterName: item.clusterName ?? objectData?.clusterName,
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

  const openRelatedObject = useCallback(
    async (item: EventDisplay) => {
      const ref = await resolveEventGridRelatedObject(
        objectPanelEventGridRow(
          {
            objectKind: item.objectKind,
            objectName: item.objectName,
            objectNamespace: item.objectNamespace,
            objectUid: item.objectUid,
            objectApiVersion: item.objectApiVersion,
            involvedObject: item.involvedObject,
            clusterId: item.clusterId ?? objectData?.clusterId,
            clusterName: item.clusterName ?? objectData?.clusterName,
          },
          CLUSTER_SCOPE
        ),
        {
          fallbackKind: objectData?.kind,
          fallbackGroup: objectData?.group,
          fallbackVersion: objectData?.version,
        }
      );
      if (ref) {
        openWithObjectRef.current(ref);
      }
    },
    [
      objectData?.clusterId,
      objectData?.clusterName,
      objectData?.group,
      objectData?.kind,
      objectData?.version,
    ]
  );

  // Alt+click: navigate to the related object's view and focus it.
  const navigateToRelatedObject = useCallback(
    async (item: EventDisplay) => {
      const ref = await resolveEventGridRelatedObject(
        objectPanelEventGridRow(
          {
            objectKind: item.objectKind,
            objectName: item.objectName,
            objectNamespace: item.objectNamespace,
            objectUid: item.objectUid,
            objectApiVersion: item.objectApiVersion,
            involvedObject: item.involvedObject,
            clusterId: item.clusterId ?? objectData?.clusterId,
            clusterName: item.clusterName ?? objectData?.clusterName,
          },
          CLUSTER_SCOPE
        ),
        {
          fallbackKind: objectData?.kind,
          fallbackGroup: objectData?.group,
          fallbackVersion: objectData?.version,
        }
      );
      if (ref) {
        navigateToView(ref);
      }
    },
    [
      navigateToView,
      objectData?.clusterId,
      objectData?.clusterName,
      objectData?.group,
      objectData?.kind,
      objectData?.version,
    ]
  );

  const columns = useMemo<GridColumnDefinition<EventDisplay>[]>(() => {
    const base: GridColumnDefinition<EventDisplay>[] = [
      createTextColumn<EventDisplay>('type', 'Type', (item) => item.type || 'Normal', {
        getClassName: (item) => `event-badge ${(item.type || 'normal').toLowerCase()}`,
      }),
      createTextColumn<EventDisplay>('source', 'Source', (item) => item.source || 'Unknown'),
      createTextColumn<EventDisplay>('reason', 'Reason', (item) => item.reason || '-'),
      createTextColumn<EventDisplay>('message', 'Message', (item) => item.message || '-', {
        getClassName: (item) => (item.message ? 'event-message' : undefined),
        getTitle: (item) => (item.message ? item.message : undefined),
      }),
      // Split the involved object into type/name columns for readability.
      createTextColumn<EventDisplay>('objectType', 'Object Type', (item) => item.objectKind || '-'),
      createTextColumn<EventDisplay>(
        'objectName',
        'Object Name',
        (item) => item.objectName || '-',
        {
          onClick: (item) => {
            void openRelatedObject(item);
          },
          onAltClick: (item) => {
            void navigateToRelatedObject(item);
          },
          getClassName: () => 'object-panel-link',
          isInteractive: canOpenRelatedObject,
        }
      ),
      (() => {
        const column = createTextColumn<EventDisplay>(
          'age',
          'Age',
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
    applyColumnSizing(base, sizing);

    return base;
  }, [canOpenRelatedObject, navigateToRelatedObject, openRelatedObject]);

  const { sortedData, sortConfig, handleSort } = useTableSort(events, 'age', 'desc', {
    columns,
  });
  const partialDataLabel = useMemo(
    () =>
      buildLocalPartialDataLabel({
        stats: eventsSnapshot.stats,
        fallback: 'Object Events are loaded as a recent local window.',
        sourceLabel: 'Object Events',
        sourceVerb: 'are',
      }),
    [eventsSnapshot.stats]
  );

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
      partialLabel: partialDataLabel,
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
          <p>Error loading events: {eventsRender.error}</p>
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
        <div className="events-display__partial-state" role="status">
          {eventsRender.partialLabel}
        </div>
        <GridTable<EventDisplay>
          data={eventsRender.rows}
          columns={columns}
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

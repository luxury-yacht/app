/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Events/EventsTab.tsx
 */

import React, { useEffect, useCallback, useMemo, useRef } from 'react';
import GridTable, {
  type GridColumnDefinition,
  GRIDTABLE_VIRTUALIZATION_DEFAULT,
} from '@shared/components/tables/GridTable';
import {
  applyColumnSizing,
  type ColumnSizingMap,
  createTextColumn,
} from '@shared/components/tables/columnFactories';
import { useTableSort } from '@hooks/useTableSort';
import { formatAge, formatFullDate } from '@utils/ageFormatter';
import { errorHandler } from '@/utils/errorHandler';
import type { ObjectEventSummary } from '@/core/refresh/types';
import { refreshManager, refreshOrchestrator } from '@/core/refresh';
import { useRefreshScopedDomain } from '@/core/refresh/store';
import { useRefreshWatcher } from '@/core/refresh/hooks/useRefreshWatcher';
import type { ObjectEventsRefresherName } from '@/core/refresh/refresherTypes';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import type { PanelObjectData } from '../types';
import { CLUSTER_SCOPE, INACTIVE_SCOPE } from '../constants';
import './EventsTab.css';

interface EventsTabProps {
  objectData?: PanelObjectData | null;
  isActive?: boolean;
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
  // Per-event cluster identity from ObjectEventSummary (extends ClusterMeta).
  clusterId?: string;
  clusterName?: string;
}

const EventsTab: React.FC<EventsTabProps> = ({ objectData, isActive }) => {
  const { openWithObject } = useObjectPanel();
  const openWithObjectRef = useRef(openWithObject);
  useEffect(() => {
    openWithObjectRef.current = openWithObject;
  }, [openWithObject]);
  const eventsScope = useMemo(() => {
    if (!objectData?.name || !objectData?.kind) {
      return null;
    }
    const namespace =
      objectData.namespace && objectData.namespace.length > 0
        ? objectData.namespace
        : CLUSTER_SCOPE;
    const rawScope = `${namespace}:${objectData.kind}:${objectData.name}`;
    return buildClusterScope(objectData?.clusterId ?? undefined, rawScope);
  }, [objectData?.clusterId, objectData?.kind, objectData?.name, objectData?.namespace]);

  const eventsSnapshot = useRefreshScopedDomain('object-events', eventsScope ?? INACTIVE_SCOPE);

  // Enable/disable the scoped domain based on tab activity. preserveState
  // keeps the store entry alive when the tab unmounts so diagnostics can still
  // see it. Full cleanup (reset) is handled by ObjectPanelContent when the
  // panel closes.
  useEffect(() => {
    if (!eventsScope) {
      return;
    }
    const enabled = Boolean(isActive && objectData);
    refreshOrchestrator.setScopedDomainEnabled('object-events', eventsScope, enabled);
    return () => {
      refreshOrchestrator.setScopedDomainEnabled('object-events', eventsScope, false, {
        preserveState: true,
      });
    };
  }, [eventsScope, isActive, objectData]);

  const fetchEvents = useCallback(
    async (isManualRefresh = false) => {
      if (!eventsScope) {
        return;
      }
      try {
        await refreshOrchestrator.fetchScopedDomain('object-events', eventsScope, {
          isManual: isManualRefresh,
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
      void fetchEvents(true);
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
        await fetchEvents(isManual);
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

  const events = useMemo<EventDisplay[]>(
    () =>
      rawEvents.map((event) => {
        const lastTime = event.lastTimestamp ? new Date(event.lastTimestamp) : new Date();
        const firstTime = event.firstTimestamp ? new Date(event.firstTimestamp) : new Date();
        const objectKind = event.involvedObjectKind || objectData?.kind || 'Unknown';
        const objectName = event.involvedObjectName || objectData?.name || 'Unknown';
        const objectNamespace =
          event.involvedObjectNamespace ?? objectData?.namespace ?? CLUSTER_SCOPE;
        return {
          type: event.eventType || 'Normal',
          source: normalizeEventSource(event.source),
          reason: event.reason || '',
          message: event.message || '',
          age: formatAge(lastTime),
          ageTimestamp: lastTime,
          firstTime,
          lastTime,
          objectKind,
          objectName,
          objectNamespace,
          clusterId: event.clusterId,
          clusterName: event.clusterName,
        };
      }),
    [rawEvents, objectData?.kind, objectData?.name, objectData?.namespace]
  );

  const eventsLoading = eventsScope
    ? !eventsSnapshot.data?.events &&
      (eventsSnapshot.status === 'loading' ||
        eventsSnapshot.status === 'initialising' ||
        eventsSnapshot.status === 'updating')
    : false;
  const eventsError = eventsScope ? (eventsSnapshot.error ?? null) : null;

  const { sortedData, sortConfig, handleSort } = useTableSort(events, 'ageTimestamp', 'desc');

  const keyExtractor = useCallback((item: EventDisplay, index: number) => {
    const namespaceSegment = item.objectNamespace || CLUSTER_SCOPE;
    const identifier = `${namespaceSegment}:${item.objectKind}:${item.objectName}`;
    return `${identifier}:${item.lastTime.getTime()}:${index}`;
  }, []);

  const openRelatedObject = useCallback(
    (item: EventDisplay) => {
      if (!item.objectKind || !item.objectName) {
        return;
      }

      const resolvedNamespace =
        item.objectNamespace && item.objectNamespace !== CLUSTER_SCOPE
          ? item.objectNamespace
          : undefined;

      // Prefer per-event cluster identity; fall back to parent panel cluster.
      openWithObjectRef.current({
        kind: item.objectKind,
        name: item.objectName,
        namespace: resolvedNamespace,
        clusterId: item.clusterId ?? objectData?.clusterId ?? undefined,
        clusterName: item.clusterName ?? objectData?.clusterName ?? undefined,
      });
    },
    [objectData?.clusterId, objectData?.clusterName]
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
          onClick: openRelatedObject,
          isInteractive: (item) => Boolean(item.objectKind && item.objectName),
        }
      ),
      (() => {
        const column = createTextColumn<EventDisplay>(
          'age',
          'Age',
          (item) => formatAge(item.ageTimestamp),
          {
            getClassName: () => 'age-cell',
            getTitle: (item) => formatFullDate(item.ageTimestamp),
          }
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
  }, [openRelatedObject]);

  if (eventsLoading && events.length === 0) {
    return (
      <div className="object-panel-tab-content">
        <div className="object-panel-placeholder">
          <p>Loading events...</p>
        </div>
      </div>
    );
  }

  if (eventsError) {
    return (
      <div className="object-panel-tab-content">
        <div className="object-panel-placeholder error">
          <p>Error loading events: {eventsError}</p>
        </div>
      </div>
    );
  }

  if (events.length === 0) {
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
          data={sortedData}
          columns={columns}
          sortConfig={sortConfig}
          onSort={handleSort}
          onRowClick={openRelatedObject}
          keyExtractor={keyExtractor}
          className="gridtable-object-events"
          virtualization={GRIDTABLE_VIRTUALIZATION_DEFAULT}
        />
      </div>
    </div>
  );
};

export default EventsTab;

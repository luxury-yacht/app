/**
 * frontend/src/shared/events/EventsGridView.tsx
 *
 * Shared skeleton for the events grid views (ClusterViewEvents /
 * NsViewEvents). Both views render the same event columns, involved-object
 * linking, object actions, and context menu around the shared
 * eventGridModel; only scope wiring (namespace defaults, row identity, the
 * namespace column, and the query hook) stays per view.
 */

import type { CanonicalResourceRef, ResourceLink } from '@core/refresh/types';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import * as cf from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { createEventTypeColumn } from '@shared/events/eventColumns';
import {
  eventGridActionReference,
  eventGridCanOpenRelatedObject,
  eventGridObjectReference,
  eventGridSearchText,
  eventGridStableKey,
  resolveEventGridRelatedObject,
} from '@shared/events/eventGridModel';
import { EVENT_LABELS } from '@shared/events/eventPresentation';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { splitEventObjectTarget } from '@shared/utils/eventObjectIdentity';
import { useCallback, useMemo } from 'react';
import { useShortNames } from '@/hooks/useShortNames';
import { getDisplayKind } from '@/utils/kindAliasMap';

/** The event row shape both scope views select from their snapshots. */
export interface EventGridRow {
  ref: CanonicalResourceRef;
  /** Involved-object kind, present on namespace Event rows. */
  kind?: string;
  kindAlias?: string;
  resourceVersion: string;
  type: string; // Event severity (Normal, Warning)
  source: string;
  reason: string;
  object: string;
  message: string;
  objectNamespace?: string;
  objectUid?: string;
  objectApiVersion?: string;
  involvedObject?: ResourceLink;
  age?: string;
  ageTimestamp?: number;
}

/**
 * useEventsGridParts wires the scope-independent event grid machinery.
 * `defaultNamespace` threads the namespace view's scope into involved-object
 * resolution and the stable row key; the cluster view passes none.
 */
export function useEventsGridParts({ defaultNamespace }: { defaultNamespace?: string } = {}) {
  const { openWithObject } = useObjectPanel();
  const { navigateToView } = useNavigateToView();
  const { selectedClusterId, selectedClusterName } = useKubeconfig();
  const useShortResourceNames = useShortNames();

  const getSearchText = useCallback(
    (event: EventGridRow): string[] => eventGridSearchText(event),
    []
  );

  const resolveOptions = useMemo(
    () =>
      defaultNamespace === undefined
        ? { selectedClusterId, selectedClusterName }
        : { defaultNamespace, selectedClusterId, selectedClusterName },
    [defaultNamespace, selectedClusterId, selectedClusterName]
  );

  const canOpenInvolvedObject = useCallback(
    (event: EventGridRow) => eventGridCanOpenRelatedObject(event, resolveOptions),
    [resolveOptions]
  );

  const openInvolvedObject = useCallback(
    async (event: EventGridRow) => {
      const ref = await resolveEventGridRelatedObject(event, resolveOptions);
      if (ref) {
        openWithObject(ref);
      }
    },
    [openWithObject, resolveOptions]
  );

  const navigateToInvolvedObject = useCallback(
    async (event: EventGridRow) => {
      const ref = await resolveEventGridRelatedObject(event, resolveOptions);
      if (ref) {
        navigateToView(ref);
      }
    },
    [navigateToView, resolveOptions]
  );

  const openEvent = useCallback(
    (event: EventGridRow) => {
      openWithObject(eventGridObjectReference(event, selectedClusterId, selectedClusterName));
    },
    [openWithObject, selectedClusterId, selectedClusterName]
  );

  const navigateToEvent = useCallback(
    (event: EventGridRow) => {
      navigateToView(eventGridObjectReference(event, selectedClusterId, selectedClusterName));
    },
    [navigateToView, selectedClusterId, selectedClusterName]
  );

  const keyExtractor = useCallback(
    (event: EventGridRow, index: number) => eventGridStableKey(event, index, defaultNamespace),
    [defaultNamespace]
  );

  /**
   * Builds the shared event columns. The namespace view passes its namespace
   * column (inserted after the type column) and omits the cluster view's
   * allowRowClick suppression on the kind column.
   */
  const buildColumns = useCallback(
    ({
      namespaceColumn,
      kindAllowRowClick = true,
    }: {
      namespaceColumn?: GridColumnDefinition<EventGridRow>;
      kindAllowRowClick?: boolean;
    }): GridColumnDefinition<EventGridRow>[] => {
      const baseColumns: GridColumnDefinition<EventGridRow>[] = [
        cf.createKindColumn<EventGridRow>({
          getKind: () => 'Event',
          getDisplayText: () => getDisplayKind('Event', useShortResourceNames),
          onClick: openEvent,
          onAltClick: navigateToEvent,
          ...(kindAllowRowClick ? {} : { allowRowClick: false }),
        }),
        createEventTypeColumn<EventGridRow>(),
      ];

      if (namespaceColumn) {
        baseColumns.push(namespaceColumn);
      }

      baseColumns.push(
        cf.createTextColumn('source', EVENT_LABELS.source, (event) => event.source || '-'),
        cf.createTextColumn<EventGridRow>('objectType', EVENT_LABELS.objectType, (event) => {
          const parsed = splitEventObjectTarget(event.object);
          return parsed.objectType;
        }),
        cf.createTextColumn<EventGridRow>(
          'objectName',
          EVENT_LABELS.objectName,
          (event) => {
            const parsed = splitEventObjectTarget(event.object);
            return parsed.objectName;
          },
          {
            onClick: (event) => {
              void openInvolvedObject(event);
            },
            onAltClick: (event) => {
              void navigateToInvolvedObject(event);
            },
            getClassName: () => 'object-panel-link',
            isInteractive: canOpenInvolvedObject,
            allowRowClick: false,
          }
        ),
        cf.createTextColumn('reason', EVENT_LABELS.reason, (event) => event.reason || '-'),
        cf.createTextColumn('message', EVENT_LABELS.message, (event) => event.message || '-'),
        cf.createAgeColumn<EventGridRow>('age', EVENT_LABELS.lastSeen, (event) => event.age)
      );

      const sizing: cf.ColumnSizingMap = {
        kind: { autoWidth: true },
        type: { autoWidth: true },
        namespace: { width: 200 },
        source: { width: 200 },
        objectType: { autoWidth: true },
        objectName: { width: 200 },
        reason: { width: 200 },
        message: { width: 250 },
        age: { autoWidth: true },
      };
      cf.applyColumnSizing(baseColumns, sizing);

      return baseColumns;
    },
    [
      canOpenInvolvedObject,
      navigateToEvent,
      navigateToInvolvedObject,
      openEvent,
      openInvolvedObject,
      useShortResourceNames,
    ]
  );

  return {
    selectedClusterId,
    selectedClusterName,
    useShortResourceNames,
    getSearchText,
    canOpenInvolvedObject,
    openInvolvedObject,
    navigateToInvolvedObject,
    openEvent,
    navigateToEvent,
    keyExtractor,
    buildColumns,
  };
}

/**
 * useEventsGridActions wires the shared object-action controller and context
 * menu over the displayed rows (the involved-object action handler reads the
 * single source of truth the table serves).
 */
export function useEventsGridActions({
  parts,
  rows,
}: {
  parts: ReturnType<typeof useEventsGridParts>;
  rows: EventGridRow[];
}) {
  const { openWithObject } = useObjectPanel();
  const { canOpenInvolvedObject, openInvolvedObject, selectedClusterId, selectedClusterName } =
    parts;

  const objectActions = useObjectActionController({
    context: 'gridtable',
    useDefaultHandlers: false,
    onOpen: (object) => openWithObject(object),
    onViewInvolvedObject: (object) => {
      const event = rows.find((candidate) => {
        const ref = eventGridObjectReference(candidate, selectedClusterId, selectedClusterName);
        return (
          ref.clusterId === object.clusterId &&
          ref.namespace === object.namespace &&
          ref.name === object.name &&
          candidate.object === object.involvedObject
        );
      });
      if (event) {
        void openInvolvedObject(event);
      }
    },
  });

  const getContextMenuItems = useCallback(
    (event: EventGridRow): ContextMenuItem[] => {
      const parsed = splitEventObjectTarget(event.object);
      const involvedObjectExtras =
        parsed.isLinkable && canOpenInvolvedObject(event)
          ? {
              involvedObject: event.object,
              involvedObjectRef: event.involvedObject,
            }
          : {};

      return objectActions.getMenuItems(
        eventGridActionReference(
          event,
          selectedClusterId,
          selectedClusterName,
          involvedObjectExtras
        )
      );
    },
    [canOpenInvolvedObject, objectActions, selectedClusterId, selectedClusterName]
  );

  return { objectActions, getContextMenuItems };
}

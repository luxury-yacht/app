import type { ResourceLink } from '@core/refresh/types';
import { LiveAgeText } from '@shared/components/LiveAgeText';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { EVENT_LABELS } from '@shared/events/eventPresentation';
import { resourceLinkToObjectReference } from '@shared/utils/resourceLinkIdentity';
import { events, type resourcemodel } from '@wailsjs/go/models';
import type React from 'react';
import type { OverviewContext, OverviewDescriptor } from '../schema';

type EventDetails = events.EventDetails;

const normalizeTimestamp = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

const renderTimestamp = (value: unknown): React.ReactNode => {
  const timestamp = normalizeTimestamp(value);
  return timestamp ? <LiveAgeText timestamp={timestamp} fullDateTitle /> : undefined;
};

const resourceLinkLabel = (link?: resourcemodel.ResourceLink): string | undefined => {
  const ref = link?.ref ?? link?.display;
  if (!ref?.kind || !ref.name) {
    return undefined;
  }
  return `${ref.kind}/${ref.name}`;
};

const renderResourceLink = (
  link: resourcemodel.ResourceLink | undefined,
  context: OverviewContext
): React.ReactNode => {
  const label = resourceLinkLabel(link);
  if (!link || !label) {
    return undefined;
  }
  const objectRef = resourceLinkToObjectReference(
    link as unknown as ResourceLink,
    context.clusterName
  );
  return objectRef ? <ObjectPanelLink objectRef={objectRef}>{label}</ObjectPanelLink> : label;
};

export const eventDescriptor: OverviewDescriptor<EventDetails> = {
  displayKind: 'Event',
  dtoClass: events.EventDetails,
  schema: {
    items: [
      { kind: 'status', label: EVENT_LABELS.type },
      {
        field: 'involvedObject',
        label: EVENT_LABELS.object,
        hidden: (d) => !resourceLinkLabel(d.involvedObject),
        render: (d, context) => renderResourceLink(d.involvedObject, context),
      },
      {
        field: 'involvedObjectFieldPath',
        label: EVENT_LABELS.subobject,
        hidden: (d) => !d.involvedObjectFieldPath,
        mono: true,
      },
      { field: 'reason', label: EVENT_LABELS.reason, hidden: (d) => !d.reason },
      {
        field: 'message',
        label: EVENT_LABELS.message,
        hidden: (d) => !d.message,
        fullWidth: true,
      },
      { field: 'count', label: EVENT_LABELS.count },
      {
        field: 'firstTimestamp',
        label: EVENT_LABELS.firstSeen,
        render: (d) => renderTimestamp(d.firstTimestamp),
      },
      {
        field: 'lastTimestamp',
        label: EVENT_LABELS.lastSeen,
        render: (d) => renderTimestamp(d.lastTimestamp),
      },
      {
        field: 'eventTime',
        label: EVENT_LABELS.eventTime,
        hidden: (d) => !normalizeTimestamp(d.eventTime),
        render: (d) => renderTimestamp(d.eventTime),
      },
      {
        field: 'seriesCount',
        label: EVENT_LABELS.seriesCount,
        hidden: (d) => d.seriesCount === undefined || d.seriesCount === null,
      },
      {
        field: 'seriesLastObservedTime',
        label: EVENT_LABELS.seriesLastSeen,
        hidden: (d) => !normalizeTimestamp(d.seriesLastObservedTime),
        render: (d) => renderTimestamp(d.seriesLastObservedTime),
      },
      { field: 'source', label: EVENT_LABELS.source, hidden: (d) => !d.source },
      { field: 'action', label: EVENT_LABELS.action, hidden: (d) => !d.action },
      {
        field: 'reportingController',
        label: EVENT_LABELS.reportingController,
        hidden: (d) => !d.reportingController,
        mono: true,
      },
      {
        field: 'reportingInstance',
        label: EVENT_LABELS.reportingInstance,
        hidden: (d) => !d.reportingInstance,
        mono: true,
      },
      {
        field: 'relatedObject',
        label: EVENT_LABELS.relatedObject,
        hidden: (d) => !resourceLinkLabel(d.relatedObject),
        render: (d, context) => renderResourceLink(d.relatedObject, context),
      },
      {
        field: 'relatedObjectFieldPath',
        label: EVENT_LABELS.relatedSubobject,
        hidden: (d) => !d.relatedObjectFieldPath,
        mono: true,
      },
    ],
  },
  // Event type is the canonical status state and is rendered by ResourceStatus as Type.
  coveredElsewhere: ['eventType'],
};

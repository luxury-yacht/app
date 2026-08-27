import {
  createStatusChipMeasurementElement,
  StatusChip,
  type StatusChipVariant,
} from '@shared/components/StatusChip';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { EVENT_LABELS } from '@shared/events/eventPresentation';

interface EventTypeRow {
  type?: string;
}

const eventTypeLabel = (row: EventTypeRow): string => row.type?.trim() || 'Normal';

const eventTypeVariant = (type: string): StatusChipVariant => {
  switch (type.toLowerCase()) {
    case 'normal':
      return 'healthy';
    case 'warning':
      return 'warning';
    default:
      return 'info';
  }
};

export const createEventTypeColumn = <T extends EventTypeRow>(): GridColumnDefinition<T> => ({
  key: 'type',
  header: EVENT_LABELS.type,
  className: 'gridtable-badge-column',
  sortable: true,
  sortValue: eventTypeLabel,
  measurementElement: (row) => {
    const type = eventTypeLabel(row);
    return createStatusChipMeasurementElement(eventTypeVariant(type), type);
  },
  render: (row) => {
    const type = eventTypeLabel(row);
    return <StatusChip variant={eventTypeVariant(type)}>{type}</StatusChip>;
  },
});

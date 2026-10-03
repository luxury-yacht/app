import {
  createStatusChipMeasurementElement,
  StatusChip,
  type StatusChipVariant,
} from '@shared/components/StatusChip';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { TABLE_NO_VALUE_TEXT } from '@shared/components/tables/tableNoValue';
import { EVENT_LABELS } from '@shared/events/eventPresentation';

interface EventTypeRow {
  type?: string;
}

const eventTypeLabel = (row: EventTypeRow): string => row.type?.trim() ?? '';

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
  // An Event without a type shows the empty placeholder rather than a chip
  // that would claim a severity the Event does not have.
  measurementElement: (row) => {
    const type = eventTypeLabel(row);
    return type
      ? createStatusChipMeasurementElement(eventTypeVariant(type), type)
      : { tagName: 'span', textContent: TABLE_NO_VALUE_TEXT };
  },
  render: (row) => {
    const type = eventTypeLabel(row);
    if (!type) {
      return TABLE_NO_VALUE_TEXT;
    }
    return <StatusChip variant={eventTypeVariant(type)}>{type}</StatusChip>;
  },
});

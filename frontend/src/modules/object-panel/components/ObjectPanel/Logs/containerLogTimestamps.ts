/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/containerLogTimestamps.ts
 *
 * Timestamp formats for container log lines and the table's API timestamp column.
 */

import {
  DEFAULT_OBJ_PANEL_LOGS_API_TIMESTAMP_FORMAT,
  formatDefaultObjPanelLogsApiTimestamp,
  formatObjPanelLogsApiTimestamp,
} from '@/utils/objPanelLogsApiTimestampFormat';
import type { LogTimestampMode } from '../types';

const formatShortTimestamp = (timestamp: string, useLocalTimeZone: boolean): string => {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return formatDefaultObjPanelLogsApiTimestamp(timestamp, useLocalTimeZone);
  }
  const hours = String(useLocalTimeZone ? parsed.getHours() : parsed.getUTCHours()).padStart(
    2,
    '0'
  );
  const minutes = String(useLocalTimeZone ? parsed.getMinutes() : parsed.getUTCMinutes()).padStart(
    2,
    '0'
  );
  const seconds = String(useLocalTimeZone ? parsed.getSeconds() : parsed.getUTCSeconds()).padStart(
    2,
    '0'
  );
  const millis = String(
    useLocalTimeZone ? parsed.getMilliseconds() : parsed.getUTCMilliseconds()
  ).padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${millis}`;
};

const formatLocalizedTimestamp = (timestamp: string, useLocalTimeZone: boolean): string => {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return formatDefaultObjPanelLogsApiTimestamp(timestamp, useLocalTimeZone);
  }
  return parsed.toLocaleString([], {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: useLocalTimeZone ? undefined : 'UTC',
  });
};

export const formatTimestampForMode = (
  timestamp: string,
  mode: LogTimestampMode,
  apiTimestampFormat: string,
  useLocalTimeZone: boolean
): string => {
  if (!timestamp || mode === 'hidden') {
    return '';
  }
  switch (mode) {
    case 'default':
      return formatObjPanelLogsApiTimestamp(timestamp, apiTimestampFormat, useLocalTimeZone);
    case 'short':
      return formatShortTimestamp(timestamp, useLocalTimeZone);
    case 'localized':
      return formatLocalizedTimestamp(timestamp, useLocalTimeZone);
    default:
      return formatObjPanelLogsApiTimestamp(
        timestamp,
        DEFAULT_OBJ_PANEL_LOGS_API_TIMESTAMP_FORMAT,
        useLocalTimeZone
      );
  }
};

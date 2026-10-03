/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useLogFiltering.ts
 *
 * Container Logs filtering: the pod/container source selection, then the
 * shared presentation pipeline.
 */

import {
  filterSelectionValues,
  type MultiSelectFilterSelection,
} from '@shared/components/dropdowns/multiSelectFilterSelection';
import { useCallback, useMemo } from 'react';
import type { ContainerLogsEntry } from '@/core/refresh/types';
import {
  classifySelectedLogSources,
  logFilterSelectionMatchesNone,
  type SelectedLogSources,
} from '../logFilterSelection';
import {
  type LogPresentation,
  type LogPresentationSource,
  useLogPresentation,
} from './useLogPresentation';

interface UseLogFilteringParams {
  logEntries: ContainerLogsEntry[];
  isWorkload: boolean;
  selectedFilters: MultiSelectFilterSelection;
  options: LogPresentationSource<ContainerLogsEntry>['options'];
  metadataColumns: LogPresentationSource<ContainerLogsEntry>['metadataColumns'];
  exportValue: LogPresentationSource<ContainerLogsEntry>['exportValue'];
}

const matchesSelectedContainer = (
  entry: ContainerLogsEntry,
  selected: SelectedLogSources
): boolean => {
  if (entry.isInit) {
    return selected.initContainers.has(entry.container);
  }
  if (entry.isEphemeral) {
    return selected.debugContainers.has(entry.container);
  }
  return selected.containers.has(entry.container);
};

const filterBySelectedLogSources = (
  entries: ContainerLogsEntry[],
  selectedValues: string[],
  isWorkload: boolean
): ContainerLogsEntry[] => {
  if (selectedValues.length === 0) {
    return entries;
  }
  const selected = classifySelectedLogSources(selectedValues);
  const podFiltered =
    isWorkload && selected.pods.size > 0
      ? entries.filter((entry) => selected.pods.has(entry.pod))
      : entries;
  const hasContainerSelection =
    selected.initContainers.size > 0 ||
    selected.containers.size > 0 ||
    selected.debugContainers.size > 0;
  return hasContainerSelection
    ? podFiltered.filter((entry) => matchesSelectedContainer(entry, selected))
    : podFiltered;
};

const containerLogSearchTexts = (entry: ContainerLogsEntry): string[] => [
  entry.line,
  entry.pod ?? '',
  entry.container ?? '',
];

const containerLogLine = (entry: ContainerLogsEntry): string => entry.line;

/**
 * Applies the container source selection, then the shared presentation
 * pipeline (text filter and JSON detection). Container search also matches pod
 * and container names.
 */
export function useLogFiltering({
  logEntries,
  isWorkload,
  selectedFilters,
  options,
  metadataColumns,
  exportValue,
}: UseLogFilteringParams): LogPresentation<ContainerLogsEntry> {
  // Entries arrive in time order: the stream manager inserts them in order and
  // previous-logs fetches are sorted by the backend.
  const sourceEntries = useMemo(
    () =>
      logEntries.length === 0 || logFilterSelectionMatchesNone(selectedFilters)
        ? []
        : filterBySelectedLogSources(
            logEntries,
            filterSelectionValues(selectedFilters),
            isWorkload
          ),
    [isWorkload, logEntries, selectedFilters]
  );
  const parsedMetadata = useCallback(
    (entry: ContainerLogsEntry) => ({
      timestamp: entry.timestamp,
      pod: isWorkload ? entry.pod : undefined,
      container: entry.container,
      isInit: entry.isInit,
      isEphemeral: entry.isEphemeral,
      seq: entry._seq,
    }),
    [isWorkload]
  );
  return useLogPresentation({
    entries: sourceEntries,
    options,
    searchTexts: containerLogSearchTexts,
    lineOf: containerLogLine,
    parsedMetadata,
    metadataColumns,
    exportValue,
  });
}

/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useLogFiltering.ts
 *
 * Handles filtering and JSON parsing of log entries.
 * Pure transformation logic extracted from LogViewer.
 */

import {
  filterSelectionValues,
  type MultiSelectFilterSelection,
} from '@shared/components/dropdowns/multiSelectFilterSelection';
import { useMemo } from 'react';
import type { ContainerLogsEntry } from '@/core/refresh/types';
import { stripAnsi } from '../ansi';
import { logFilterSelectionMatchesNone } from '../logFilterSelection';
import { buildLogSearchRegex } from '../logSearch';
import type { ParsedLogEntry } from '../logViewerReducer';
import { tryParseJSONObject } from '../parsedLogUtils';

interface UseLogFilteringParams {
  logEntries: ContainerLogsEntry[];
  isWorkload: boolean;
  selectedFilters: MultiSelectFilterSelection;
  textFilter: string;
  inverseMatches: boolean;
  caseSensitiveMatches: boolean;
  regexMatches: boolean;
}

interface UseLogFilteringResult {
  filteredEntries: ContainerLogsEntry[];
  parsedCandidates: ParsedLogEntry[];
  canParseContainerLogs: boolean;
}

type TimestampedLogEntry = {
  entry: ContainerLogsEntry;
  index: number;
  timestamp: string;
  timestampMs: number | null;
};

type SelectedLogSources = {
  pods: Set<string>;
  initContainers: Set<string>;
  containers: Set<string>;
  debugContainers: Set<string>;
};

const timestampLogEntry = (entry: ContainerLogsEntry, index: number): TimestampedLogEntry => {
  const timestamp = entry.timestamp?.trim() ?? '';
  const parsedTimestamp = timestamp ? Date.parse(timestamp) : Number.NaN;
  return {
    entry,
    index,
    timestamp,
    timestampMs: Number.isNaN(parsedTimestamp) ? null : parsedTimestamp,
  };
};

const compareTimestampedLogEntries = (
  left: TimestampedLogEntry,
  right: TimestampedLogEntry
): number => {
  if (left.timestampMs === null) {
    return right.timestampMs === null ? left.index - right.index : 1;
  }
  if (right.timestampMs === null) {
    return -1;
  }
  if (left.timestampMs !== right.timestampMs) {
    return left.timestampMs - right.timestampMs;
  }
  if (left.timestamp < right.timestamp) {
    return -1;
  }
  if (left.timestamp > right.timestamp) {
    return 1;
  }
  return left.index - right.index;
};

const orderLogEntries = (entries: ContainerLogsEntry[]): ContainerLogsEntry[] => {
  if (entries.length <= 1) {
    return entries;
  }
  return entries
    .map(timestampLogEntry)
    .sort(compareTimestampedLogEntries)
    .map(({ entry }) => entry);
};

const valuesForPrefix = (values: string[], prefix: string): Set<string> =>
  new Set(
    values
      .filter((value) => value.startsWith(prefix))
      .map((value) => value.substring(prefix.length))
  );

const classifySelectedLogSources = (values: string[]): SelectedLogSources => ({
  pods: valuesForPrefix(values, 'pod:'),
  initContainers: valuesForPrefix(values, 'init:'),
  containers: valuesForPrefix(values, 'container:'),
  debugContainers: valuesForPrefix(values, 'debug:'),
});

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

const matchesLogText = (
  regex: RegExp | null,
  sourceText: string,
  normalizedText: string,
  searchText: string
): boolean => (regex ? regex.test(sourceText) : normalizedText.includes(searchText));

const logEntryMatchesSearch = (
  entry: ContainerLogsEntry,
  searchText: string,
  regex: RegExp | null,
  caseSensitive: boolean
): boolean => {
  const lineText = stripAnsi(entry.line);
  const podText = entry.pod ?? '';
  const containerText = entry.container ?? '';
  const normalize = (value: string): string => (caseSensitive ? value : value.toLowerCase());
  const lineMatches = matchesLogText(regex, lineText, normalize(lineText), searchText);
  const podMatches = matchesLogText(regex, podText, normalize(podText), searchText);
  const containerMatches = matchesLogText(
    regex,
    containerText,
    normalize(containerText),
    searchText
  );
  return lineMatches || podMatches || containerMatches;
};

const filterByLogText = (
  entries: ContainerLogsEntry[],
  textFilter: string,
  inverseMatches: boolean,
  caseSensitiveMatches: boolean,
  regexMatches: boolean
): ContainerLogsEntry[] => {
  if (!textFilter.trim()) {
    return entries;
  }
  const searchText = caseSensitiveMatches ? textFilter : textFilter.toLowerCase();
  const regex = regexMatches
    ? buildLogSearchRegex(textFilter, { regexMode: true, caseSensitive: caseSensitiveMatches })
    : null;
  if (regexMatches && !regex) {
    return [];
  }
  return entries.filter((entry) => {
    const matches = logEntryMatchesSearch(entry, searchText, regex, caseSensitiveMatches);
    return inverseMatches ? !matches : matches;
  });
};

const filterLogEntries = ({
  entries,
  isWorkload,
  selectedFilters,
  textFilter,
  inverseMatches,
  caseSensitiveMatches,
  regexMatches,
}: {
  entries: ContainerLogsEntry[];
  isWorkload: boolean;
  selectedFilters: MultiSelectFilterSelection;
  textFilter: string;
  inverseMatches: boolean;
  caseSensitiveMatches: boolean;
  regexMatches: boolean;
}): ContainerLogsEntry[] => {
  if (entries.length === 0 || logFilterSelectionMatchesNone(selectedFilters)) {
    return [];
  }
  const sourceFiltered = filterBySelectedLogSources(
    entries,
    filterSelectionValues(selectedFilters),
    isWorkload
  );
  return filterByLogText(
    sourceFiltered,
    textFilter,
    inverseMatches,
    caseSensitiveMatches,
    regexMatches
  );
};

/**
 * Handles filtering and JSON parsing of log entries.
 * Pure transformation logic extracted from LogViewer.
 */
export function useLogFiltering({
  logEntries,
  isWorkload,
  selectedFilters,
  textFilter,
  inverseMatches,
  caseSensitiveMatches,
  regexMatches,
}: UseLogFilteringParams): UseLogFilteringResult {
  const orderedEntries = useMemo(
    // Keep log lines in deterministic chronological order across pods/containers.
    () => orderLogEntries(logEntries),
    [logEntries]
  );

  const filteredEntries = useMemo(
    () =>
      filterLogEntries({
        entries: orderedEntries,
        isWorkload,
        selectedFilters,
        textFilter,
        inverseMatches,
        caseSensitiveMatches,
        regexMatches,
      }),
    [
      caseSensitiveMatches,
      inverseMatches,
      isWorkload,
      orderedEntries,
      regexMatches,
      selectedFilters,
      textFilter,
    ]
  );

  const parsedCandidates = useMemo(() => {
    if (!filteredEntries.length) {
      return [] as ParsedLogEntry[];
    }
    const parsed: ParsedLogEntry[] = [];
    filteredEntries.forEach((entry, index) => {
      const jsonData = tryParseJSONObject(entry.line);
      if (!jsonData) {
        return;
      }
      const normalizedLine = stripAnsi(entry.line);
      parsed.push({
        data: jsonData,
        rawLine: normalizedLine,
        lineNumber: index + 1,
        timestamp: entry.timestamp,
        pod: isWorkload ? entry.pod : undefined,
        container: entry.container,
        isInit: entry.isInit,
        isEphemeral: entry.isEphemeral,
        seq: entry._seq,
      });
    });
    return parsed;
  }, [filteredEntries, isWorkload]);

  const canParseContainerLogs = parsedCandidates.length > 0;

  return { filteredEntries, parsedCandidates, canParseContainerLogs };
}

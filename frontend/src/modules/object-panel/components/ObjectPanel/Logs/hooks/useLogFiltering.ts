/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useLogFiltering.ts
 *
 * Handles filtering and JSON parsing of log entries.
 * Pure transformation logic extracted from LogViewer.
 */
import { useMemo } from 'react';
import type { ContainerLogsEntry } from '@/core/refresh/types';
import type { ParsedLogEntry } from '../logViewerReducer';
import { stripAnsi } from '../ansi';
import { tryParseJSONObject } from '../jsonLogs';

interface UseLogFilteringParams {
  logEntries: ContainerLogsEntry[];
  isWorkload: boolean;
  selectedFilters: string[];
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
  const orderedEntries = useMemo(() => {
    if (logEntries.length <= 1) {
      return logEntries;
    }

    // Keep log lines in deterministic chronological order across pods/containers.
    const withIndex = logEntries.map((entry, index) => {
      const timestamp = entry.timestamp?.trim() ?? '';
      const parsedTimestamp = timestamp ? Date.parse(timestamp) : Number.NaN;
      return {
        entry,
        index,
        timestamp,
        timestampMs: Number.isNaN(parsedTimestamp) ? null : parsedTimestamp,
      };
    });

    withIndex.sort((a, b) => {
      const aHasTimestamp = a.timestampMs !== null;
      const bHasTimestamp = b.timestampMs !== null;

      if (aHasTimestamp && bHasTimestamp) {
        // Both are non-null since aHasTimestamp/bHasTimestamp confirmed it
        const aMs = a.timestampMs as number;
        const bMs = b.timestampMs as number;
        if (aMs !== bMs) {
          return aMs - bMs;
        }
        if (a.timestamp < b.timestamp) {
          return -1;
        }
        if (a.timestamp > b.timestamp) {
          return 1;
        }
        return a.index - b.index;
      }

      if (aHasTimestamp !== bHasTimestamp) {
        return aHasTimestamp ? -1 : 1;
      }

      return a.index - b.index;
    });

    return withIndex.map((item) => item.entry);
  }, [logEntries]);

  const filteredEntries = useMemo(() => {
    if (!orderedEntries.length) {
      return [] as ContainerLogsEntry[];
    }

    let entries = orderedEntries;

    // Filter by selected pods/containers.
    if (selectedFilters.length > 0) {
      const selectedPods = new Set(
        selectedFilters
          .filter((filterValue) => filterValue.startsWith('pod:'))
          .map((filterValue) => filterValue.substring(4))
      );
      const selectedInitContainers = new Set(
        selectedFilters
          .filter((filterValue) => filterValue.startsWith('init:'))
          .map((filterValue) => filterValue.substring(5))
      );
      const selectedContainers = new Set(
        selectedFilters
          .filter((filterValue) => filterValue.startsWith('container:'))
          .map((filterValue) => filterValue.substring(10))
      );
      const selectedDebugContainers = new Set(
        selectedFilters
          .filter((filterValue) => filterValue.startsWith('debug:'))
          .map((filterValue) => filterValue.substring(6))
      );

      if (isWorkload && selectedPods.size > 0) {
        entries = entries.filter((entry) => selectedPods.has(entry.pod));
      }
      if (
        selectedInitContainers.size > 0 ||
        selectedContainers.size > 0 ||
        selectedDebugContainers.size > 0
      ) {
        entries = entries.filter((entry) =>
          entry.isInit
            ? selectedInitContainers.has(entry.container)
            : entry.isEphemeral
              ? selectedDebugContainers.has(entry.container)
              : selectedContainers.has(entry.container)
        );
      }
    }

    // Filter by text search
    if (textFilter.trim()) {
      const searchText = caseSensitiveMatches ? textFilter : textFilter.toLowerCase();
      const regex = regexMatches ? buildSearchRegex(textFilter, caseSensitiveMatches) : null;
      if (regexMatches && !regex) {
        return [] as ContainerLogsEntry[];
      }
      entries = entries.filter((entry) => {
        const lineText = stripAnsi(entry.line);
        const podText = entry.pod ?? '';
        const containerText = entry.container ?? '';
        const normalizedLineText = caseSensitiveMatches ? lineText : lineText.toLowerCase();
        const normalizedPodText = caseSensitiveMatches ? podText : podText.toLowerCase();
        const normalizedContainerText = caseSensitiveMatches
          ? containerText
          : containerText.toLowerCase();
        const lineMatches = regex ? regex.test(lineText) : normalizedLineText.includes(searchText);
        const podMatches = regex ? regex.test(podText) : normalizedPodText.includes(searchText);
        const containerMatches = regex
          ? regex.test(containerText)
          : normalizedContainerText.includes(searchText);
        const matches = lineMatches || podMatches || containerMatches;
        return inverseMatches ? !matches : matches;
      });
    }

    return entries;
  }, [
    caseSensitiveMatches,
    inverseMatches,
    isWorkload,
    orderedEntries,
    regexMatches,
    selectedFilters,
    textFilter,
  ]);

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

function buildSearchRegex(pattern: string, caseSensitive: boolean): RegExp | null {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return new RegExp(trimmed, caseSensitive ? '' : 'i');
  } catch {
    return null;
  }
}

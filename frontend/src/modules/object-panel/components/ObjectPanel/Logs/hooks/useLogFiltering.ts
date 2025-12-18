import { useMemo } from 'react';
import type { ObjectLogEntry } from '@/core/refresh/types';
import type { ParsedLogEntry } from '../logViewerReducer';

interface UseLogFilteringParams {
  logEntries: ObjectLogEntry[];
  isWorkload: boolean;
  selectedFilter: string;
  selectedContainer: string;
  textFilter: string;
}

interface UseLogFilteringResult {
  filteredEntries: ObjectLogEntry[];
  parsedCandidates: ParsedLogEntry[];
  canParseLogs: boolean;
}

/**
 * Handles filtering and JSON parsing of log entries.
 * Pure transformation logic extracted from LogViewer.
 */
export function useLogFiltering({
  logEntries,
  isWorkload,
  selectedFilter,
  selectedContainer,
  textFilter,
}: UseLogFilteringParams): UseLogFilteringResult {
  const ALL_CONTAINERS = '';

  const filteredEntries = useMemo(() => {
    if (!logEntries.length) {
      return [] as ObjectLogEntry[];
    }

    let entries = logEntries;

    // Filter by pod or container for workload views
    if (isWorkload && selectedFilter) {
      if (selectedFilter.startsWith('pod:')) {
        const podName = selectedFilter.substring(4);
        entries = entries.filter((entry) => entry.pod === podName);
      } else if (selectedFilter.startsWith('container:')) {
        const containerName = selectedFilter.substring(10);
        entries = entries.filter((entry) => entry.container === containerName);
      }
    }

    // Filter by container for single-pod views
    if (!isWorkload && selectedContainer && selectedContainer !== ALL_CONTAINERS) {
      entries = entries.filter((entry) => entry.container === selectedContainer);
    }

    // Filter by text search
    if (textFilter.trim()) {
      const searchText = textFilter.toLowerCase();
      entries = entries.filter((entry) => {
        const lineMatches = entry.line.toLowerCase().includes(searchText);
        const podMatches = entry.pod?.toLowerCase().includes(searchText) || false;
        const containerMatches = entry.container?.toLowerCase().includes(searchText) || false;
        return lineMatches || podMatches || containerMatches;
      });
    }

    return entries;
  }, [isWorkload, logEntries, selectedFilter, selectedContainer, textFilter]);

  const parsedCandidates = useMemo(() => {
    if (!filteredEntries.length) {
      return [] as ParsedLogEntry[];
    }
    const parsed: ParsedLogEntry[] = [];
    filteredEntries.forEach((entry, index) => {
      try {
        const jsonData = JSON.parse(entry.line);
        parsed.push({
          ...jsonData,
          _rawLine: entry.line,
          _lineNumber: index + 1,
          _timestamp: entry.timestamp,
          _pod: isWorkload ? entry.pod : 'undefined',
          _container: entry.container,
        });
      } catch {
        // Not JSON, ignore
      }
    });
    return parsed;
  }, [filteredEntries, isWorkload]);

  const canParseLogs = parsedCandidates.length > 0;

  return { filteredEntries, parsedCandidates, canParseLogs };
}

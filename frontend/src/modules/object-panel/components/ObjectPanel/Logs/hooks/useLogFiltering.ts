/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useLogFiltering.ts
 *
 * Handles filtering and JSON parsing of log entries.
 * Pure transformation logic extracted from LogViewer.
 */
import { useMemo } from 'react';
import type { ObjectLogEntry } from '@/core/refresh/types';
import type { ParsedLogEntry } from '../logViewerReducer';
import { stripAnsi } from '../ansi';

interface UseLogFilteringParams {
  logEntries: ObjectLogEntry[];
  isWorkload: boolean;
  selectedFilters: string[];
  textFilter: string;
  inverseMatches: boolean;
  regexMatches: boolean;
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
  selectedFilters,
  textFilter,
  inverseMatches,
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
      return [] as ObjectLogEntry[];
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

      if (isWorkload && selectedPods.size > 0) {
        entries = entries.filter((entry) => selectedPods.has(entry.pod));
      }
      if (selectedInitContainers.size > 0 || selectedContainers.size > 0) {
        entries = entries.filter((entry) =>
          entry.isInit
            ? selectedInitContainers.has(entry.container)
            : selectedContainers.has(entry.container)
        );
      }
    }

    // Filter by text search
    if (textFilter.trim()) {
      const searchText = textFilter.toLowerCase();
      const regex = regexMatches ? buildSearchRegex(textFilter) : null;
      if (regexMatches && !regex) {
        return [] as ObjectLogEntry[];
      }
      entries = entries.filter((entry) => {
        const lineText = stripAnsi(entry.line);
        const lineMatches = regex
          ? regex.test(lineText)
          : lineText.toLowerCase().includes(searchText);
        const podMatches = regex
          ? regex.test(entry.pod ?? '')
          : entry.pod?.toLowerCase().includes(searchText) || false;
        const containerMatches = regex
          ? regex.test(entry.container ?? '')
          : entry.container?.toLowerCase().includes(searchText) || false;
        const matches = lineMatches || podMatches || containerMatches;
        return inverseMatches ? !matches : matches;
      });
    }

    return entries;
  }, [inverseMatches, isWorkload, orderedEntries, regexMatches, selectedFilters, textFilter]);

  const parsedCandidates = useMemo(() => {
    if (!filteredEntries.length) {
      return [] as ParsedLogEntry[];
    }
    const parsed: ParsedLogEntry[] = [];
    filteredEntries.forEach((entry, index) => {
      try {
        const normalizedLine = stripAnsi(entry.line);
        const jsonData = JSON.parse(normalizedLine);
        // Only accept non-empty plain objects (reject arrays, primitives, null, {})
        if (
          typeof jsonData !== 'object' ||
          jsonData === null ||
          Array.isArray(jsonData) ||
          Object.keys(jsonData).length === 0
        ) {
          return;
        }
        parsed.push({
          data: jsonData,
          rawLine: normalizedLine,
          lineNumber: index + 1,
          timestamp: entry.timestamp,
          pod: isWorkload ? entry.pod : undefined,
          container: entry.container,
          seq: entry._seq,
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

function buildSearchRegex(pattern: string): RegExp | null {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return new RegExp(trimmed, 'i');
  } catch {
    return null;
  }
}

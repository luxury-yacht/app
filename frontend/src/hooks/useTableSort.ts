/**
 * frontend/src/hooks/useTableSort.ts
 *
 * Hook for useTableSort.
 * Provides sorting functionality for tables, including special handling for age and timestamp columns.
 * Supports both controlled and uncontrolled sorting states.
 */
import { useState, useMemo } from 'react';

export type SortDirection = 'asc' | 'desc' | null;

export interface SortConfig {
  key: string;
  direction: SortDirection;
}

export interface UseTableSortOptions {
  controlledSort?: SortConfig | null;
  onChange?: (config: SortConfig) => void;
}

export function useTableSort<T>(
  data: T[],
  defaultSortKey?: string,
  defaultDirection: SortDirection = 'asc',
  options?: UseTableSortOptions
) {
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    key: defaultSortKey || '',
    direction: defaultSortKey ? defaultDirection : null,
  });

  const effectiveSort = options?.controlledSort ?? sortConfig;

  // Sort a column. When `targetDirection` is provided the sort jumps directly
  // to that state (used by context-menu "Sort Desc" / "Clear Sort"). When
  // omitted the direction cycles: asc → desc → null → asc.
  const handleSort = (key: string, targetDirection?: SortDirection) => {
    const computeNext = (prev: SortConfig): SortConfig => {
      if (targetDirection !== undefined) {
        return { key, direction: targetDirection };
      }
      if (prev.key === key) {
        const nextDirection =
          prev.direction === 'asc' ? 'desc' : prev.direction === 'desc' ? null : 'asc';
        return { key, direction: nextDirection };
      }
      return { key, direction: defaultDirection };
    };

    if (options?.controlledSort) {
      const next = computeNext(options.controlledSort);
      options.onChange?.(next);
      return;
    }

    setSortConfig((prevConfig) => computeNext(prevConfig));
  };

  // Helper function to parse age strings to seconds for sorting
  const parseAge = (ageStr: string): number => {
    if (!ageStr || ageStr === '-') return 0;

    // Parse age strings like "2y", "3mo", "2d", "5h", "30m", "45s", "2d5h", etc.
    // Note: Kubernetes uses 'y' for years, 'mo' for months, 'd' for days, 'h' for hours, 'm' for minutes, 's' for seconds
    const units: Record<string, number> = {
      y: 365 * 86400, // years (approximate: 365 days)
      mo: 30 * 86400, // months (approximate: 30 days)
      d: 86400, // days
      h: 3600, // hours
      m: 60, // minutes
      s: 1, // seconds
    };

    let totalSeconds = 0;

    // Updated regex to handle 'mo' for months and 'y' for years
    const matches = ageStr.match(/(\d+)(y|mo|d|h|m|s)/g);

    if (matches) {
      matches.forEach((match) => {
        const matchResult = match.match(/(\d+)(y|mo|d|h|m|s)/);
        if (matchResult) {
          const [, num, unit] = matchResult;
          if (num && unit && units[unit]) {
            totalSeconds += parseInt(num) * units[unit];
          }
        }
      });
    }

    return totalSeconds;
  };

  const sortedData = useMemo(() => {
    // Handle null or undefined data
    if (!data) {
      return [];
    }

    if (!effectiveSort.key || !effectiveSort.direction) {
      return data;
    }

    return [...data].sort((a, b) => {
      const aValue = (a as any)[effectiveSort.key];
      const bValue = (b as any)[effectiveSort.key];

      // Handle null/undefined values
      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;

      // Special handling for age columns (only if they contain age strings, not numbers)
      if (
        effectiveSort.key.toLowerCase() === 'age' &&
        typeof aValue === 'string' &&
        typeof bValue === 'string'
      ) {
        const aSeconds = parseAge(aValue);
        const bSeconds = parseAge(bValue);
        const comparison = aSeconds - bSeconds;
        return effectiveSort.direction === 'asc' ? comparison : -comparison;
      }

      // Special handling for timestamp columns (if they exist)
      if (
        effectiveSort.key === 'timestamp' &&
        typeof aValue === 'number' &&
        typeof bValue === 'number'
      ) {
        const comparison = aValue - bValue;
        return effectiveSort.direction === 'asc' ? comparison : -comparison;
      }

      // Compare values
      let comparison = 0;
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        comparison = aValue.localeCompare(bValue, undefined, { numeric: true });
      } else if (typeof aValue === 'number' && typeof bValue === 'number') {
        comparison = aValue - bValue;
      } else {
        // Convert to string for comparison
        comparison = String(aValue).localeCompare(String(bValue), undefined, { numeric: true });
      }

      return effectiveSort.direction === 'asc' ? comparison : -comparison;
    });
  }, [data, effectiveSort]);

  return {
    sortedData,
    sortConfig: effectiveSort,
    handleSort,
  };
}

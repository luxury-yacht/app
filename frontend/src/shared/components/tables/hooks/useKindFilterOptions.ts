import { useMemo } from 'react';

interface KindFilterOptionRow {
  kind?: string | null;
}

/**
 * Typed table views currently derive kind filter options from their loaded row
 * payloads. Keep that logic shared and explicit until a domain exposes richer
 * kind metadata.
 */
export const useKindFilterOptions = <T extends KindFilterOptionRow>(rows: T[]): string[] =>
  useMemo(
    () =>
      [...new Set(rows.map((row) => row.kind?.trim() ?? '').filter(Boolean))].sort((a, b) =>
        a.localeCompare(b)
      ),
    [rows]
  );

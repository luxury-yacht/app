import { useCallback, useEffect, useState } from 'react';

export const DIAGNOSTICS_ROW_INCREMENT = 250;

export const useDiagnosticsTableControls = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(DIAGNOSTICS_ROW_INCREMENT);
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<string>>(() => new Set());
  const normalizedSearch = searchTerm.trim().toLowerCase();

  const toggleRow = useCallback((key: string) => {
    setExpandedRows((previous) => {
      const next = new Set(previous);
      if (!next.delete(key)) {
        next.add(key);
      }
      return next;
    });
  }, []);
  const showMoreRows = useCallback((totalRows: number) => {
    setVisibleLimit((current) => Math.min(current + DIAGNOSTICS_ROW_INCREMENT, totalRows));
  }, []);

  useEffect(() => {
    void normalizedSearch;
    setVisibleLimit(DIAGNOSTICS_ROW_INCREMENT);
    setExpandedRows(new Set());
  }, [normalizedSearch]);

  return {
    searchTerm,
    setSearchTerm,
    normalizedSearch,
    visibleLimit,
    expandedRows,
    toggleRow,
    showMoreRows,
  };
};

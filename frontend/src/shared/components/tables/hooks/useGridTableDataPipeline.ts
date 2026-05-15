import { useEffect, useMemo, useRef, useState } from 'react';
import { eventBus } from '@/core/events';
import { getMaxTableRows } from '@/core/settings/appPreferences';
import { recordGridTablePerformanceSnapshot } from '@shared/components/tables/performance/gridTablePerformanceStore';
import type { GridTableProps } from '@shared/components/tables/GridTable.types';

interface UseGridTableDataPipelineOptions<T> {
  inputData: GridTableProps<T>['data'];
  filteredData: T[];
  maxTableRows: number;
  totalDataCount: number;
  diagnosticsLabel: string | undefined;
  diagnosticsMode: NonNullable<GridTableProps<T>['diagnosticsMode']>;
}

export function useGridTableSourceData<T>(inputData: GridTableProps<T>['data']) {
  const [maxTableRows, setMaxTableRows] = useState<number>(() => getMaxTableRows());
  const totalDataCount = Array.isArray(inputData) ? inputData.length : 0;
  const sourceData = useMemo<T[]>(
    () => (Array.isArray(inputData) ? inputData : ([] as T[])),
    [inputData]
  );

  useEffect(() => {
    return eventBus.on('settings:max-table-rows', (value) => {
      setMaxTableRows(value);
    });
  }, []);

  return {
    maxTableRows,
    sourceData,
    totalDataCount,
  };
}

export function useGridTableDataPipeline<T>({
  inputData,
  filteredData,
  maxTableRows,
  totalDataCount,
  diagnosticsLabel,
  diagnosticsMode,
}: UseGridTableDataPipelineOptions<T>) {
  const previousInputDataRef = useRef(inputData);
  const tableData = useMemo<T[]>(
    () => filteredData.slice(0, maxTableRows),
    [filteredData, maxTableRows]
  );

  useEffect(() => {
    if (!diagnosticsLabel) {
      previousInputDataRef.current = inputData;
      return;
    }

    const inputReferenceChanged = previousInputDataRef.current !== inputData;
    recordGridTablePerformanceSnapshot(diagnosticsLabel, {
      mode: diagnosticsMode,
      inputRows: totalDataCount,
      sourceRows: Math.min(totalDataCount, maxTableRows),
      displayedRows: tableData.length,
      inputReferenceChanged,
    });
    previousInputDataRef.current = inputData;
  }, [
    diagnosticsLabel,
    diagnosticsMode,
    inputData,
    maxTableRows,
    tableData.length,
    totalDataCount,
  ]);

  return {
    tableData,
  };
}

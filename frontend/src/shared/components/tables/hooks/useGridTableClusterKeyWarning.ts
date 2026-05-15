import { useRef } from 'react';

interface UseGridTableClusterKeyWarningOptions<T> {
  tableData: T[];
  keyExtractor: (item: T, index: number) => string;
  warnDevOnce: (message: string) => void;
}

export function useGridTableClusterKeyWarning<T>({
  tableData,
  keyExtractor,
  warnDevOnce,
}: UseGridTableClusterKeyWarningOptions<T>) {
  const clusterKeyCheckRef = useRef(false);
  const keyExtractorRef = useRef(keyExtractor);

  if (keyExtractorRef.current !== keyExtractor) {
    keyExtractorRef.current = keyExtractor;
    clusterKeyCheckRef.current = false;
  }

  if (import.meta.env.DEV && !clusterKeyCheckRef.current && tableData.length > 0) {
    clusterKeyCheckRef.current = true;
    const sampleKey = keyExtractor(tableData[0], 0);
    if (!sampleKey.includes('|')) {
      warnDevOnce(
        `GridTable: keyExtractor returned "${sampleKey}" which does not appear ` +
          `cluster-scoped (missing "|" separator). Use buildClusterScopedKey() ` +
          `to prevent key collisions in multi-cluster views.`
      );
    }
  }
}

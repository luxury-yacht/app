/**
 * frontend/src/core/refresh/diagnostics/useCatalogDiagnostics.ts
 *
 * Lightweight browse diagnostics: track catalog update frequency and warn on
 * update bursts that risk React update-depth errors. No UI changes.
 */

import { useEffect, useRef } from 'react';

import { logAppDebug, logAppWarn } from '@/core/logging/appLogClient';
import type { DomainSnapshotState } from '@/core/refresh/store';
import type { CatalogSnapshotPayload } from '@/core/refresh/types';

const UPDATE_WINDOW_MS = 2000;
const WARN_THRESHOLD = 20;
const INFO_INTERVAL_MS = 15000;
const WARN_INTERVAL_MS = 15000;
const LOG_SOURCE = 'CatalogDiagnostics';

export const useCatalogDiagnostics = (
  domain: DomainSnapshotState<CatalogSnapshotPayload>,
  viewLabel: string
): void => {
  const lastUpdatedRef = useRef<number | undefined>(undefined);
  const windowStartRef = useRef<number>(0);
  const countRef = useRef<number>(0);
  const lastInfoRef = useRef<number>(0);
  const lastWarnRef = useRef<number>(0);

  useEffect(() => {
    const updatedAt = domain.lastUpdated;
    if (!updatedAt || updatedAt === lastUpdatedRef.current) {
      return;
    }

    lastUpdatedRef.current = updatedAt;
    const now = Date.now();

    if (!windowStartRef.current || now - windowStartRef.current > UPDATE_WINDOW_MS) {
      if (countRef.current > 0 && now - lastInfoRef.current > INFO_INTERVAL_MS) {
        logAppDebug(
          `[${viewLabel}] catalog updates: ${countRef.current}/${UPDATE_WINDOW_MS}ms`,
          LOG_SOURCE
        );
        lastInfoRef.current = now;
      }
      windowStartRef.current = now;
      countRef.current = 0;
    }

    countRef.current += 1;
    if (countRef.current >= WARN_THRESHOLD && now - lastWarnRef.current > WARN_INTERVAL_MS) {
      logAppWarn(
        `[${viewLabel}] catalog update rate high (${countRef.current}/${UPDATE_WINDOW_MS}ms). ` +
          `Risk of React update-depth warnings.`,
        LOG_SOURCE
      );
      lastWarnRef.current = now;
    }
  }, [domain.lastUpdated, viewLabel]);
};

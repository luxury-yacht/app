import type { backend } from '@core/backend-api/models';
import { onEvent } from '@core/desktop-runtime';
import { useCallback, useEffect, useRef, useState } from 'react';
import { readAppInfo, requestAppState } from '@/core/app-state-access';

// Version metadata and live update state have different lifetimes. A late
// metadata read must not replace an update event or an explicit action result.
export const useAppInfo = (enabled = true) => {
  const [appInfo, setAppInfo] = useState<Omit<backend.AppInfo, 'update'> | null>(null);
  const [updateState, setUpdateState] = useState<backend.UpdateInfo | null>(null);
  const updateRevision = useRef(0);

  const setUpdate = useCallback((next: backend.UpdateInfo | null) => {
    updateRevision.current += 1;
    setUpdateState(next);
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let active = true;
    const unsubscribe = onEvent('app-update', (next) => {
      if (next) {
        setUpdate(next);
      }
    });
    const revision = updateRevision.current;
    requestAppState({ resource: 'app-info', read: readAppInfo })
      .then((info) => {
        if (!active || !info) {
          return;
        }
        const { update: snapshot, ...metadata } = info;
        setAppInfo(metadata);
        if (updateRevision.current === revision) {
          setUpdate(snapshot ?? null);
        }
      })
      .catch(() => {
        // Metadata is best-effort; subsequent update events remain available.
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [enabled, setUpdate]);

  return { appInfo, update: updateState, setUpdate };
};

import type { backend } from '@core/backend-api/models';
import { onEvent } from '@core/desktop-runtime';
import { useCallback, useEffect, useState } from 'react';
import { readAppInfo, requestAppState } from '@/core/app-state-access';

// Update snapshots arrive over events, the app-info read, and action results,
// in any order. The backend stamps each committed change with a higher
// revision, so an older snapshot never replaces a newer one.
const newerUpdate = (
  current: backend.UpdateInfo | null,
  next: backend.UpdateInfo | null
): backend.UpdateInfo | null => {
  if (!current) {
    return next;
  }
  return next && next.revision >= current.revision ? next : current;
};

// Version metadata and live update state have different lifetimes. A late
// metadata read must not replace an update event or an explicit action result.
export const useAppInfo = (enabled = true) => {
  const [appInfo, setAppInfo] = useState<Omit<backend.AppInfo, 'update'> | null>(null);
  const [updateState, setUpdateState] = useState<backend.UpdateInfo | null>(null);

  const setUpdate = useCallback((next: backend.UpdateInfo | null) => {
    setUpdateState((current) => newerUpdate(current, next));
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
    requestAppState({ resource: 'app-info', read: readAppInfo })
      .then((info) => {
        if (!active || !info) {
          return;
        }
        const { update: snapshot, ...metadata } = info;
        setAppInfo(metadata);
        setUpdate(snapshot ?? null);
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

/**
 * frontend/src/ui/status/UpdateStatus.tsx
 *
 * Header info chip shown when an application update needs attention. It is a
 * label and nothing more: clicking opens the About dialog, which owns the whole
 * update workflow — versions, release notes, progress, failures, and recovery.
 * Owns the app-info fetch and the `app-update` runtime event.
 */

import type { backend } from '@core/backend-api/models';
import { useModalState } from '@core/contexts/ModalStateContext';
import { onEvent } from '@core/desktop-runtime';
import React, { useCallback, useEffect, useState } from 'react';
import { readAppInfo, requestAppState } from '@/core/app-state-access';
import { getUpdatePresentation } from './updatePresentation';
import './UpdateStatus.css';

type AppInfoWithUpdate = backend.AppInfo & {
  update?: backend.UpdateInfo | null;
};

const UpdateStatus: React.FC = () => {
  const [updateInfo, setUpdateInfo] = useState<backend.UpdateInfo | null>(null);
  const { setIsAboutOpen } = useModalState();

  useEffect(() => {
    let active = true;
    requestAppState({ resource: 'app-info', read: () => readAppInfo() })
      .then((info) => {
        if (active) {
          setUpdateInfo((info as AppInfoWithUpdate).update ?? null);
        }
      })
      .catch(() => {
        // Update metadata is best-effort; stay silent if it can't be read.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleUpdate = (payload: backend.UpdateInfo | null) => {
      if (payload) {
        setUpdateInfo(payload);
      }
    };
    return onEvent('app-update', handleUpdate);
  }, []);

  const handleClick = useCallback(() => {
    setIsAboutOpen(true);
  }, [setIsAboutOpen]);

  // The shared presentation decides which states are worth a header chip; quiet
  // states (disabled, checking, up to date, skipped) still have About copy but no badge.
  const badge = updateInfo ? getUpdatePresentation(updateInfo)?.badge : undefined;
  if (!badge) {
    return null;
  }

  return (
    <button
      type="button"
      className="update-chip"
      onClick={handleClick}
      aria-label={`${badge} — open About`}
      data-testid="update-status-chip"
    >
      {badge}
    </button>
  );
};

export default React.memo(UpdateStatus);

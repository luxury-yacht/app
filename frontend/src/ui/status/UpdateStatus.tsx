/**
 * frontend/src/ui/status/UpdateStatus.tsx
 *
 * Header info chip shown when an application update needs attention. It is a
 * label and nothing more: clicking opens the About dialog, which owns the whole
 * update workflow — versions, release notes, progress, failures, and recovery.
 * Uses the shared app-info and live update state hook.
 */

import { useModalState } from '@core/contexts/ModalStateContext';
import { useAppInfo } from '@shared/hooks/useAppInfo';
import React, { useCallback } from 'react';
import { getUpdatePresentation } from './updatePresentation';
import './UpdateStatus.css';

const UpdateStatus: React.FC = () => {
  const { update: updateInfo } = useAppInfo();
  const { setIsAboutOpen } = useModalState();

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

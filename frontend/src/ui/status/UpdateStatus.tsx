/**
 * frontend/src/ui/status/UpdateStatus.tsx
 *
 * Header info chip shown when a newer app release is available. Clickable to open
 * the release page; hover reveals version + release details via the shared
 * Tooltip. Owns the app-info fetch and the `app-update` runtime event (previously
 * embedded in ClusterOverview).
 */
import React, { useCallback, useEffect, useState } from 'react';
import Tooltip from '@shared/components/Tooltip';
import { readAppInfo, requestAppState } from '@/core/app-state-access';
import { BrowserOpenURL } from '@wailsjs/runtime/runtime';
import { backend } from '@wailsjs/go/models';
import './UpdateStatus.css';

interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  releaseName?: string;
  publishedAt?: string;
  currentPublishedAt?: string;
  checkedAt?: string;
  isUpdateAvailable: boolean;
  releaseNotes?: string;
  error?: string;
}

type AppInfoWithUpdate = backend.AppInfo & {
  update?: UpdateInfo | null;
};

// Full rendered release notes live on the version's GitHub release page.
const RELEASE_NOTES_TAG_BASE = 'https://github.com/luxury-yacht/app/releases/tag/';

// Render the ISO publish date as YYYY-MM-DD from its UTC components (matches
// GitHub's UTC published_at and is timezone-stable); null when absent or
// unparseable so the tooltip simply omits the date.
const formatPublished = (iso?: string): string | null => {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const UpdateStatus: React.FC = () => {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

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
    const runtime = window.runtime;
    if (!runtime?.EventsOn) {
      return;
    }
    const handleUpdate = (...args: unknown[]) => {
      const payload = args[0] as UpdateInfo | undefined;
      if (payload) {
        setUpdateInfo(payload);
      }
    };
    runtime.EventsOn('app-update', handleUpdate);
    return () => {
      runtime.EventsOff?.('app-update', handleUpdate);
    };
  }, []);

  const handleClick = useCallback(() => {
    if (updateInfo?.releaseUrl) {
      BrowserOpenURL(updateInfo.releaseUrl);
    }
  }, [updateInfo]);

  if (!updateInfo?.isUpdateAvailable || !updateInfo.releaseUrl) {
    return null;
  }

  const newDate = formatPublished(updateInfo.publishedAt);
  const currentDate = formatPublished(updateInfo.currentPublishedAt);
  const notes = updateInfo.releaseNotes?.trim();
  const notesUrl = `${RELEASE_NOTES_TAG_BASE}${encodeURIComponent(updateInfo.latestVersion)}`;
  const openNotes = () => BrowserOpenURL(notesUrl);
  const renderVersion = (version: string, date: string | null) => (
    <span>
      {version}
      {date && <span className="update-status__tooltip-date"> ({date})</span>}
    </span>
  );

  const tooltip = (
    <div className="update-status__tooltip">
      <div className="update-status__tooltip-rows">
        <span className="update-status__tooltip-label">New:</span>
        {renderVersion(updateInfo.latestVersion, newDate)}
        {updateInfo.currentVersion && (
          <>
            <span className="update-status__tooltip-label">Current:</span>
            {renderVersion(updateInfo.currentVersion, currentDate)}
          </>
        )}
      </div>
      {notes && (
        <>
          <div className="update-status__tooltip-divider" />
          <div className="update-status__tooltip-notes" data-testid="update-status-notes">
            {notes}
          </div>
        </>
      )}
      <button
        type="button"
        className="update-status__tooltip-link"
        onClick={openNotes}
        data-testid="update-status-notes-link"
      >
        Full release notes ↗
      </button>
    </div>
  );

  return (
    <Tooltip content={tooltip} className="update-status-tooltip" interactive maxWidth={360}>
      <button
        type="button"
        className="update-chip"
        onClick={handleClick}
        aria-label={`Version ${updateInfo.latestVersion} available — open release page`}
        data-testid="update-status-chip"
      >
        Update available
      </button>
    </Tooltip>
  );
};

export default React.memo(UpdateStatus);

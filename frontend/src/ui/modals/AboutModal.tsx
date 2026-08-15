/**
 * frontend/src/ui/modals/AboutModal.tsx
 *
 * The About dialog. It is also the single surface for the application update
 * workflow: the header chip only opens this modal, so availability, release
 * notes, progress, failures, and recovery actions all present here.
 */

import React, { useEffect, useRef, useState } from 'react';
import './AboutModal.css';
import captainK8s from '@assets/captain-k8s-color.png';
import logo from '@assets/luxury-yacht-logo.png';
import {
  CheckForUpdates,
  DownloadApplicationUpdate,
  RemoveApplicationUpdateSkip,
  RestartAndApplyApplicationUpdate,
  SkipApplicationUpdate,
} from '@core/backend-api';
import type { backend } from '@core/backend-api/models';
import { onEvent, openURL } from '@core/desktop-runtime';
import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import { InfoIcon } from '@shared/components/icons/SharedIcons';
import ModalHeader from '@shared/components/modals/ModalHeader';
import ModalSurface from '@shared/components/modals/ModalSurface';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import { readAppInfo, requestAppState } from '@/core/app-state-access';
import { reportOperationalError } from '@/utils/errorHandler';
import {
  getUpdatePresentation,
  type UpdateAction,
  type UpdatePresentation,
  type UpdatePresentationAction,
} from '../status/updatePresentation';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const HOMEPAGE_URL = 'https://luxury-yacht.app';
const WAILS_URL = 'https://v3.wails.io';
const LICENSE_URL = 'https://www.gnu.org/licenses/gpl-3.0.html';

const updateActionNames: Record<UpdateAction, string> = {
  check: 'checkApplicationUpdate',
  download: 'downloadApplicationUpdate',
  restart: 'restartAndApplyApplicationUpdate',
  skip: 'skipApplicationUpdate',
  'remove-skip': 'removeApplicationUpdateSkip',
  recovery: 'openApplicationUpdateRecovery',
};

const withUpdate = (
  current: backend.AppInfo | null,
  update: backend.UpdateInfo
): backend.AppInfo | null => (current ? { ...current, update } : current);

const progressPercentFor = (update: backend.UpdateInfo): number | null => {
  const progress = update.progressPercent;
  return typeof progress === 'number' &&
    Number.isFinite(progress) &&
    progress >= 0 &&
    progress <= 100
    ? progress
    : null;
};

/** Desktop links open in the user's browser, never in the app window. */
const ExternalLink: React.FC<{
  href: string;
  className?: string;
  children: React.ReactNode;
  testId?: string;
}> = ({ href, className, children, testId }) => (
  <a
    href={href}
    className={className}
    data-testid={testId}
    onClick={(event) => {
      event.preventDefault();
      openURL(href);
    }}
  >
    {children}
  </a>
);

const performUpdateAction = async (
  action: UpdateAction,
  update: backend.UpdateInfo,
  url?: string
): Promise<backend.UpdateInfo | null> => {
  switch (action) {
    case 'recovery':
      if (url) {
        openURL(url);
      }
      return null;
    case 'check':
      return CheckForUpdates();
    case 'download':
      return update.availableVersion ? DownloadApplicationUpdate(update.availableVersion) : null;
    case 'restart':
      return RestartAndApplyApplicationUpdate();
    case 'skip':
      return update.availableVersion ? SkipApplicationUpdate(update.availableVersion) : null;
    case 'remove-skip':
      return RemoveApplicationUpdateSkip();
  }
};

const useApplicationUpdateAction = (
  update: backend.UpdateInfo | null,
  setAppInfo: React.Dispatch<React.SetStateAction<backend.AppInfo | null>>
) => {
  const [updateAction, setUpdateAction] = useState<UpdateAction | null>(null);

  const runUpdateAction = async (action: UpdateAction, url?: string) => {
    if (!update || updateAction) {
      return;
    }
    if (action === 'recovery') {
      await performUpdateAction(action, update, url);
      return;
    }
    setUpdateAction(action);
    try {
      const next = await performUpdateAction(action, update, url);
      if (next) {
        setAppInfo((current) => withUpdate(current, next));
      }
    } catch (error) {
      reportOperationalError(error, {
        source: 'AboutModal',
        action: updateActionNames[action],
      });
    } finally {
      setUpdateAction(null);
    }
  };

  return { updateAction, runUpdateAction };
};

interface UpdateActionButtonProps {
  action?: UpdatePresentationAction;
  primary?: boolean;
  busy: boolean;
  onAction: (action: UpdateAction, url?: string) => Promise<void>;
}

const UpdateActionButton: React.FC<UpdateActionButtonProps> = ({
  action,
  primary = false,
  busy,
  onAction,
}) => {
  if (!action) {
    return null;
  }
  return (
    <button
      type="button"
      className={primary ? 'button save' : 'button generic'}
      disabled={busy}
      onClick={() => void onAction(action.kind, action.url)}
    >
      {action.label}
    </button>
  );
};

const ReleaseNotes: React.FC<{ presentation: UpdatePresentation }> = ({ presentation }) => {
  if (!presentation.notes) {
    return null;
  }
  return (
    <div className="about-release">
      <div className="about-release-header">
        <h3>{presentation.releaseTitle}</h3>
        {presentation.published ? (
          <span className="about-release-date">{presentation.published}</span>
        ) : null}
      </div>
      <div className="about-release-notes" data-testid="about-release-notes">
        {presentation.notes}
      </div>
    </div>
  );
};

interface ApplicationUpdateSectionProps {
  update: backend.UpdateInfo;
  presentation: UpdatePresentation;
  updateAction: UpdateAction | null;
  onAction: (action: UpdateAction, url?: string) => Promise<void>;
}

const ApplicationUpdateSection: React.FC<ApplicationUpdateSectionProps> = ({
  update,
  presentation,
  updateAction,
  onAction,
}) => {
  const progressPercent = progressPercentFor(update);
  return (
    <section className="about-update" aria-label="Application update">
      <div className="about-update-summary">
        {/* The message is the status. A pill above it only repeated the sentence
            — verbatim, for the downloading/verifying/preparing states. */}
        <p className="about-update-message">{presentation.message}</p>
        {presentation.explanation ? (
          <p className="about-update-explanation">{presentation.explanation}</p>
        ) : null}
      </div>

      {progressPercent !== null ? (
        <div className="about-update-progress">
          <progress value={progressPercent} max={100} />
          <span>{Math.round(progressPercent)}%</span>
        </div>
      ) : null}

      {update.error ? (
        <p className="about-update-error">
          <ErrorSurface kind="status" message={update.error} />
        </p>
      ) : null}

      {/* Actions before the notes: what the user can do outranks the preview of
          what changed, in reading order and in tab order. */}
      {presentation.primary || presentation.secondary || presentation.releaseNotesURL ? (
        <div className="about-update-actions">
          <UpdateActionButton
            action={presentation.primary}
            primary={true}
            busy={updateAction !== null}
            onAction={onAction}
          />
          <UpdateActionButton
            action={presentation.secondary}
            busy={updateAction !== null}
            onAction={onAction}
          />
          {presentation.releaseNotesURL ? (
            <ExternalLink
              href={presentation.releaseNotesURL}
              className="about-release-link"
              testId="about-release-notes-link"
            >
              Full release notes ↗
            </ExternalLink>
          ) : null}
        </div>
      ) : null}

      <ReleaseNotes presentation={presentation} />
    </section>
  );
};

const AboutModal: React.FC<AboutModalProps> = React.memo(({ isOpen, onClose }) => {
  const [isClosing, setIsClosing] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [appInfo, setAppInfo] = useState<backend.AppInfo | null>(null);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsClosing(false);
      // Fetch app info when modal opens
      requestAppState({
        resource: 'app-info',
        read: () => readAppInfo(),
      })
        .then((info) => {
          setAppInfo(info);
        })
        .catch(() => {
          // Silent fallback for GetAppInfo errors
        });
    } else if (shouldRender) {
      setIsClosing(true);
      const timer = setTimeout(() => {
        setShouldRender(false);
        setIsClosing(false);
      }, 200); // Match the animation duration
      return () => clearTimeout(timer);
    }
  }, [isOpen, shouldRender]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    return onEvent('app-update', (updateSnapshot) => {
      if (updateSnapshot) {
        setAppInfo((current) => withUpdate(current, updateSnapshot));
      }
    });
  }, [isOpen]);

  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const modalRef = useRef<HTMLDivElement>(null);

  useModalFocusTrap({
    ref: modalRef,
    disabled: !shouldRender,
    onEscape: () => {
      if (!isOpen) {
        return false;
      }
      onClose();
      return true;
    },
  });

  const update = appInfo?.update ?? null;
  const { updateAction, runUpdateAction } = useApplicationUpdateAction(update, setAppInfo);

  if (!shouldRender) {
    return null;
  }

  const updatePresentation = update ? getUpdatePresentation(update) : null;

  return (
    <ModalSurface
      modalRef={modalRef}
      labelledBy="about-modal-title"
      onClose={onClose}
      containerClassName="about-modal"
      isClosing={isClosing}
      closeOnBackdrop={true}
    >
      <ModalHeader title="About" titleId="about-modal-title" icon={InfoIcon} onClose={onClose} />

      <div className="modal-content about-modal-content">
        <div className="about-hero">
          <div className="about-logo-section">
            <img
              src={captainK8s}
              alt="Captain K8s"
              className="about-captain-k8s"
              width={1024}
              height={1024}
            />
            <img
              src={logo}
              alt="Luxury Yacht Logo"
              className="about-logo"
              width={827}
              height={500}
            />
          </div>
          <p className="about-version">Version {appInfo?.version || 'Loading...'}</p>
          {updatePresentation?.versionNote ? (
            <p className="about-version-note">{updatePresentation.versionNote}</p>
          ) : null}
          {updatePresentation?.versionNote && updatePresentation.primary ? (
            <UpdateActionButton
              action={updatePresentation.primary}
              busy={updateAction !== null}
              onAction={runUpdateAction}
            />
          ) : null}
          {appInfo?.isBeta && appInfo?.expiryDate ? (
            <p className="about-beta-expiry">
              Beta expires {new Date(appInfo.expiryDate).toLocaleDateString()}
            </p>
          ) : null}
        </div>

        {update && updatePresentation && !updatePresentation.versionNote ? (
          <ApplicationUpdateSection
            update={update}
            presentation={updatePresentation}
            updateAction={updateAction}
            onAction={runUpdateAction}
          />
        ) : null}

        <p className="about-links">
          <ExternalLink href={HOMEPAGE_URL}>luxury-yacht.app</ExternalLink>
          <span className="about-links-separator" aria-hidden="true">
            ·
          </span>
          <span>
            Built with <ExternalLink href={WAILS_URL}>Wails</ExternalLink>
          </span>
        </p>
      </div>

      <div className="about-footer">
        <p className="about-license">
          Licensed under the GNU General Public License, version 3 (GPLv3), and distributed WITHOUT
          ANY WARRANTY, explicit or implied. See the{' '}
          <ExternalLink href={LICENSE_URL}>GNU General Public License</ExternalLink> for more
          details.
        </p>
        <p className="about-copyright">Copyright © 2025-2026 Luxury Yacht</p>
      </div>
    </ModalSurface>
  );
});

export default AboutModal;

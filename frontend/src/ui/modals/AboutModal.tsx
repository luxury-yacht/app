/**
 * frontend/src/components/modals/AboutModal.tsx
 *
 * UI component for AboutModal.
 * Handles rendering and interactions for the shared components.
 */

import React, { useEffect, useRef, useState } from 'react';
import './AboutModal.css';
import captainK8s from '@assets/captain-k8s-color.png';
import logo from '@assets/luxury-yacht-logo.png';
import {
  CheckForUpdates,
  DownloadApplicationUpdate,
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
import { toPlainReleaseNotes } from '../status/releaseNotesText';
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

const updateActionNames: Record<UpdateAction, string> = {
  check: 'checkApplicationUpdate',
  download: 'downloadApplicationUpdate',
  restart: 'restartAndApplyApplicationUpdate',
  skip: 'skipApplicationUpdate',
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
      className={primary ? 'p-btn p-prim-col about-update-action' : 'p-btn about-update-action'}
      disabled={busy}
      onClick={() => void onAction(action.kind, action.url)}
    >
      {action.label}
    </button>
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
      <p className="about-update-message">{presentation.message}</p>
      {presentation.explanation ? (
        <p className="about-update-explanation">{presentation.explanation}</p>
      ) : null}
      {progressPercent !== null ? (
        <div className="about-update-progress">
          <progress value={progressPercent} max={100} />
          <span>{Math.round(progressPercent)}%</span>
        </div>
      ) : null}
      {update.releaseNotes ? (
        <div className="about-update-notes">{toPlainReleaseNotes(update.releaseNotes)}</div>
      ) : null}
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
      </div>
      {update.error ? (
        <p className="about-update-error">
          <ErrorSurface kind="status" message={update.error} />
        </p>
      ) : null}
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
    return onEvent('app-update', (updateSnapshot?: backend.UpdateInfo) => {
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

      <div className="modal-content">
        <div className="about-logo-section">
          <img
            src={captainK8s}
            alt="Captain K8s"
            className="about-captain-k8s"
            width={1024}
            height={1024}
          />
          <img src={logo} alt="Luxury Yacht Logo" className="about-logo" width={827} height={500} />
        </div>

        <div className="about-info">
          <div className="about-description">
            <p>
              <strong>Version {appInfo?.version || 'Loading...'}</strong>
            </p>
            {update && updatePresentation ? (
              <ApplicationUpdateSection
                update={update}
                presentation={updatePresentation}
                updateAction={updateAction}
                onAction={runUpdateAction}
              />
            ) : null}
            {appInfo?.isBeta && appInfo?.expiryDate ? (
              <p className="about-beta-expiry">
                Beta expires: {new Date(appInfo.expiryDate).toLocaleDateString()}
              </p>
            ) : null}
            <p className="about-link-row">
              <a
                href="https://luxury-yacht.app"
                onClick={(e) => {
                  e.preventDefault();
                  openURL('https://luxury-yacht.app');
                }}
              >
                luxury-yacht.app
              </a>
            </p>
            <p className="about-link-row">
              Built with{' '}
              <a
                href="https://wails.io/"
                onClick={(e) => {
                  e.preventDefault();
                  openURL('https://wails.io/');
                }}
              >
                Wails
              </a>
            </p>
          </div>

          <div className="about-footer">
            <p className="about-license">
              This application is licensed under the GNU General Public License, version 3 (GPLv3).
              This application is distributed WITHOUT ANY WARRANTY, explicit or implied. See the{' '}
              <a
                href="https://www.gnu.org/licenses/gpl-3.0.html"
                onClick={(e) => {
                  e.preventDefault();
                  openURL('https://www.gnu.org/licenses/gpl-3.0.html');
                }}
              >
                GNU General Public License
              </a>{' '}
              for more details.
            </p>
            <p className="about-copyright">Copyright © 2025-2026 Luxury Yacht</p>
          </div>
        </div>
      </div>
    </ModalSurface>
  );
});

export default AboutModal;

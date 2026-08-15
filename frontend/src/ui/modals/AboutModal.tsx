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
import { getUpdatePresentation, type UpdateAction } from '../status/updatePresentation';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AboutModal: React.FC<AboutModalProps> = React.memo(({ isOpen, onClose }) => {
  const [isClosing, setIsClosing] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [appInfo, setAppInfo] = useState<backend.AppInfo | null>(null);
  const [updateAction, setUpdateAction] = useState<UpdateAction | null>(null);

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
        setAppInfo((current) => (current ? { ...current, update: updateSnapshot } : current));
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

  if (!shouldRender) {
    return null;
  }

  const update = appInfo?.update ?? null;
  const updatePresentation = update ? getUpdatePresentation(update) : null;
  const progressPercent =
    typeof update?.progressPercent === 'number' &&
    Number.isFinite(update.progressPercent) &&
    update.progressPercent >= 0 &&
    update.progressPercent <= 100
      ? update.progressPercent
      : null;
  const runUpdateAction = async (action: UpdateAction, url?: string) => {
    if (!update || updateAction) {
      return;
    }
    if (action === 'recovery') {
      if (url) {
        openURL(url);
      }
      return;
    }
    setUpdateAction(action);
    try {
      let next: backend.UpdateInfo | null = null;
      if (action === 'check') {
        next = await CheckForUpdates();
      } else if (action === 'download' && update.availableVersion) {
        next = await DownloadApplicationUpdate(update.availableVersion);
      } else if (action === 'restart') {
        next = await RestartAndApplyApplicationUpdate();
      } else if (action === 'skip' && update.availableVersion) {
        next = await SkipApplicationUpdate(update.availableVersion);
      }
      if (next) {
        setAppInfo((current) => (current ? { ...current, update: next } : current));
      }
    } catch (error) {
      const actionName = {
        check: 'checkApplicationUpdate',
        download: 'downloadApplicationUpdate',
        restart: 'restartAndApplyApplicationUpdate',
        skip: 'skipApplicationUpdate',
        recovery: 'openApplicationUpdateRecovery',
      }[action];
      reportOperationalError(error, { source: 'AboutModal', action: actionName });
    } finally {
      setUpdateAction(null);
    }
  };

  const renderAction = (action: NonNullable<typeof updatePresentation>['primary']) =>
    action ? (
      <button
        type="button"
        className="p-btn p-prim-col about-update-action"
        disabled={updateAction !== null}
        onClick={() => void runUpdateAction(action.kind, action.url)}
      >
        {action.label}
      </button>
    ) : null;

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
            {updatePresentation ? (
              <section className="about-update" aria-label="Application update">
                <p className="about-update-message">{updatePresentation.message}</p>
                {updatePresentation.explanation ? (
                  <p className="about-update-explanation">{updatePresentation.explanation}</p>
                ) : null}
                {progressPercent !== null ? (
                  <div className="about-update-progress">
                    <progress value={progressPercent} max={100} />
                    <span>{Math.round(progressPercent)}%</span>
                  </div>
                ) : null}
                {update?.releaseNotes ? (
                  <div className="about-update-notes">
                    {toPlainReleaseNotes(update.releaseNotes)}
                  </div>
                ) : null}
                <div className="about-update-actions">
                  {renderAction(updatePresentation.primary)}
                  {updatePresentation.secondary ? (
                    <button
                      type="button"
                      className="p-btn about-update-action"
                      disabled={updateAction !== null}
                      onClick={() =>
                        void runUpdateAction(
                          updatePresentation.secondary?.kind ?? 'recovery',
                          updatePresentation.secondary?.url
                        )
                      }
                    >
                      {updatePresentation.secondary.label}
                    </button>
                  ) : null}
                </div>
                {update?.error ? (
                  <p className="about-update-error">
                    <ErrorSurface kind="status" message={update.error} />
                  </p>
                ) : null}
              </section>
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

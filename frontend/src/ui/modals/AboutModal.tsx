/**
 * frontend/src/components/modals/AboutModal.tsx
 *
 * UI component for AboutModal.
 * Handles rendering and interactions for the shared components.
 */

import React, { useState, useEffect, useRef } from 'react';
import './modals.css';
import './AboutModal.css';
import logo from '@assets/luxury-yacht-logo.png';
import captainK8s from '@assets/captain-k8s-color.png';
import { BrowserOpenURL } from '@wailsjs/runtime/runtime';
import { GetAppInfo } from '@wailsjs/go/backend/App';
import { backend } from '@wailsjs/go/models';
import { useShortcut, useKeyboardContext } from '@ui/shortcuts';
import { KeyboardContextPriority } from '@ui/shortcuts/priorities';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import ModalSurface from '@shared/components/modals/ModalSurface';
import { CloseIcon } from '@shared/components/icons/MenuIcons';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AboutModal: React.FC<AboutModalProps> = React.memo(({ isOpen, onClose }) => {
  const [isClosing, setIsClosing] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [appInfo, setAppInfo] = useState<backend.AppInfo | null>(null);
  const { pushContext, popContext } = useKeyboardContext();
  const contextPushedRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsClosing(false);
      // Fetch app info when modal opens
      GetAppInfo()
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
      if (contextPushedRef.current) {
        popContext();
        contextPushedRef.current = false;
      }
      document.body.style.overflow = '';
      return;
    }

    pushContext({ priority: KeyboardContextPriority.ABOUT_MODAL });
    contextPushedRef.current = true;
    document.body.style.overflow = 'hidden';

    return () => {
      if (contextPushedRef.current) {
        popContext();
        contextPushedRef.current = false;
      }
      document.body.style.overflow = '';
    };
  }, [isOpen, popContext, pushContext]);

  useShortcut({
    key: 'Escape',
    handler: () => {
      if (!isOpen) return false;
      onClose();
      return true;
    },
    description: 'Close about modal',
    category: 'Modals',
    enabled: isOpen,
    view: 'global',
    priority: KeyboardContextPriority.ABOUT_MODAL,
  });

  const modalRef = useRef<HTMLDivElement>(null);

  useModalFocusTrap({
    ref: modalRef,
    disabled: !shouldRender,
    onEscape: () => {
      if (!isOpen) return false;
      onClose();
      return true;
    },
  });

  if (!shouldRender) return null;

  return (
    <ModalSurface
      modalRef={modalRef}
      labelledBy="about-modal-title"
      onClose={onClose}
      containerClassName="about-modal"
      isClosing={isClosing}
    >
      <div className="modal-header">
        <h2 id="about-modal-title">About</h2>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>
      </div>

      <div className="modal-content">
        <div className="about-logo-section">
          <img src={captainK8s} alt="Captain K8s" className="about-captain-k8s" />
          <img src={logo} alt="Luxury Yacht Logo" className="about-logo" />
        </div>

        <div className="about-info">
          <div className="about-description">
            <p>
              <strong>Version {appInfo?.version || 'Loading...'}</strong>
            </p>
            {appInfo?.update ? (
              appInfo.update.isUpdateAvailable ? (
                <p className="about-update-available">
                  Update available:{' '}
                  <a
                    href={appInfo.update.releaseUrl}
                    onClick={(e) => {
                      e.preventDefault();
                      BrowserOpenURL(appInfo.update!.releaseUrl);
                    }}
                  >
                    {appInfo.update.latestVersion}
                  </a>
                </p>
              ) : !appInfo.update.error ? (
                <p className="about-up-to-date">
                  <span className="about-up-to-date-icon">&#x2714;</span> Up to date
                </p>
              ) : null
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
                  BrowserOpenURL('https://luxury-yacht.app');
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
                  BrowserOpenURL('https://wails.io/');
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
                  BrowserOpenURL('https://www.gnu.org/licenses/gpl-3.0.html');
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

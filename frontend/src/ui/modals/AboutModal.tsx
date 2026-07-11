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
import { InfoIcon } from '@shared/components/icons/SharedIcons';
import ModalHeader from '@shared/components/modals/ModalHeader';
import ModalSurface from '@shared/components/modals/ModalSurface';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import type { backend } from '@wailsjs/go/models';
import { BrowserOpenURL } from '@wailsjs/runtime/runtime';
import { readAppInfo, requestAppState } from '@/core/app-state-access';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

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
            {appInfo?.update ? (
              appInfo.update.isUpdateAvailable ? (
                <p className="about-update-available">
                  Update available:{' '}
                  <a
                    href={appInfo.update.releaseUrl}
                    onClick={(e) => {
                      e.preventDefault();
                      const releaseUrl = appInfo.update?.releaseUrl;
                      if (releaseUrl) {
                        BrowserOpenURL(releaseUrl);
                      }
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

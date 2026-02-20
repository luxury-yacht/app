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
import { KeyboardContextPriority, KeyboardScopePriority } from '@ui/shortcuts/priorities';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
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
    focusableSelector: '[data-about-focusable="true"]',
    priority: KeyboardScopePriority.ABOUT_MODAL,
    disabled: !isOpen,
  });

  if (!shouldRender) return null;

  return (
    <>
      <div className={`modal-overlay ${isClosing ? 'closing' : ''}`} onClick={onClose}>
        <div
          className={`modal-container about-modal ${isClosing ? 'closing' : ''}`}
          style={{ maxWidth: '500px' }}
          onClick={(e) => e.stopPropagation()}
          ref={modalRef}
        >
          <div className="modal-header">
            <h2>About</h2>
            <button
              className="modal-close"
              onClick={onClose}
              aria-label="Close"
              data-about-focusable="true"
            >
              <CloseIcon />
            </button>
          </div>

          <div className="modal-content">
            <div className="about-logo-section">
              <img src={captainK8s} alt="Captain K8s" className="about-captain-k8s" />
              <img src={logo} alt="Luxury Yacht Logo" className="about-logo" />
            </div>

            <div className="about-info">
              {/* <div className="about-details">
                <div className="about-field">
                  <span className="about-label">Version:</span>
                  <span className="about-value">1.0.0</span>
                </div>

                <div className="about-field">
                  <span className="about-label">Built with:</span>
                  <span className="about-value">Wails</span>
                </div>
              </div> */}

              <div className="about-description">
                <p>Version {appInfo?.version || 'Loading...'}</p>
                {appInfo?.isBeta && appInfo?.expiryDate ? (
                  <p style={{ color: 'var(--color-warning)', fontSize: '0.9em' }}>
                    Beta expires: {new Date(appInfo.expiryDate).toLocaleDateString()}
                  </p>
                ) : null}
                <p>
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
                  This application is licensed under the GNU General Public License, version 3
                  (GPLv3). This application is distributed WITHOUT ANY WARRANTY, explicit or
                  implied. See the{' '}
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
        </div>
      </div>
    </>
  );
});

export default AboutModal;

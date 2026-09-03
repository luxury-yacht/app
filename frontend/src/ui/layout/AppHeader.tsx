/**
 * frontend/src/ui/layout/AppHeader.tsx
 *
 * Module source for AppHeader.
 * Implements AppHeader logic for the UI layer.
 */

import { closeWindow, minimiseWindow, toggleMaximise } from '@core/desktop-runtime';
import { SearchIcon } from '@shared/components/icons/SharedIcons';
import FavMenuDropdown from '@ui/favorites/FavMenuDropdown';
import ConnectivityStatus from '@ui/status/ConnectivityStatus';
import MetricsStatus from '@ui/status/MetricsStatus';
import SessionsStatus from '@ui/status/SessionsStatus';
import UpdateStatus from '@ui/status/UpdateStatus';
import React from 'react';
import { eventBus } from '@/core/events';
import { isMacPlatform } from '@/utils/platform';
import './AppHeader.css';
import AppMenuBar from './AppMenuBar';

interface AppHeaderProps {
  mode?: 'workspace' | 'panel';
}

const AppHeader: React.FC<AppHeaderProps> = ({ mode = 'workspace' }) => {
  const isMac = isMacPlatform();
  const usesCustomFrame = !isMac;
  const isModalOpen = () =>
    typeof document !== 'undefined' && document.body.classList.contains('modal-surface-open');

  const toggleWindowMaximize = () => {
    if (!isModalOpen()) {
      toggleMaximise();
    }
  };

  const headerClassName = [
    'app-header',
    isMac ? 'app-header--mac' : '',
    usesCustomFrame ? 'app-header--custom-frame' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <header className={headerClassName} data-app-region="header">
      {mode === 'workspace' && usesCustomFrame ? <AppMenuBar /> : null}
      <button
        type="button"
        className="app-header-drag-control"
        aria-label="Toggle window maximize"
        title="Double-click to maximize or restore the window"
        onClick={(event) => {
          if (event.detail === 0) {
            toggleWindowMaximize();
          }
        }}
        onDoubleClick={toggleWindowMaximize}
      />
      {mode === 'workspace' ? (
        <div className="app-header-controls">
          <UpdateStatus />
          <div className="status-indicators">
            <ConnectivityStatus />
            <MetricsStatus />
            <SessionsStatus />
          </div>
          <FavMenuDropdown />
          <button
            type="button"
            className="settings-button"
            onClick={() => eventBus.emit('command-palette:open')}
            title={`Command Palette (${isMac ? '⇧⌘P' : 'Ctrl+Shift+P'})`}
            aria-label="Command Palette"
            data-app-header-last-focusable="true"
          >
            <SearchIcon width={14} height={14} />
          </button>
        </div>
      ) : null}
      {usesCustomFrame ? (
        <div className="app-header-window-controls">
          <button
            type="button"
            className="app-header-window-control app-header-window-control--minimise"
            aria-label="Minimise window"
            title="Minimise"
            onClick={() => void minimiseWindow()}
          >
            <svg
              className="app-header-window-control-glyph"
              viewBox="0 0 18 18"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M5 12h8" />
            </svg>
          </button>
          <button
            type="button"
            className="app-header-window-control app-header-window-control--maximise"
            aria-label="Maximise or restore window"
            title="Maximise or restore"
            onClick={toggleWindowMaximize}
          >
            <svg
              className="app-header-window-control-glyph"
              viewBox="0 0 18 18"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M6.5 4.5h-2v2M11.5 4.5h2v2M6.5 13.5h-2v-2M11.5 13.5h2v-2" />
            </svg>
          </button>
          <button
            type="button"
            className="app-header-window-control app-header-window-control--close"
            aria-label="Close window"
            title="Close"
            onClick={() => void closeWindow()}
          >
            <svg
              className="app-header-window-control-glyph"
              viewBox="0 0 18 18"
              aria-hidden="true"
              focusable="false"
            >
              <path d="m5 5 8 8m0-8-8 8" />
            </svg>
          </button>
        </div>
      ) : null}
    </header>
  );
};

export default React.memo(AppHeader);

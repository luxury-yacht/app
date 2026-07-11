/**
 * frontend/src/ui/layout/AppHeader.tsx
 *
 * Module source for AppHeader.
 * Implements AppHeader logic for the UI layer.
 */

import { SearchIcon } from '@shared/components/icons/SharedIcons';
import FavMenuDropdown from '@ui/favorites/FavMenuDropdown';
import ConnectivityStatus from '@ui/status/ConnectivityStatus';
import MetricsStatus from '@ui/status/MetricsStatus';
import SessionsStatus from '@ui/status/SessionsStatus';
import UpdateStatus from '@ui/status/UpdateStatus';
import { WindowToggleMaximise } from '@wailsjs/runtime/runtime';
import React from 'react';
import { eventBus } from '@/core/events';
import { isMacPlatform } from '@/utils/platform';
import './AppHeader.css';

const AppHeader: React.FC = () => {
  const isMac = isMacPlatform();
  const isModalOpen = () =>
    typeof document !== 'undefined' && document.body.classList.contains('modal-surface-open');

  const toggleWindowMaximize = () => {
    if (!isModalOpen()) {
      WindowToggleMaximise();
    }
  };

  return (
    <header className={`app-header${isMac ? ' app-header--mac' : ''}`} data-app-region="header">
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
    </header>
  );
};

export default React.memo(AppHeader);

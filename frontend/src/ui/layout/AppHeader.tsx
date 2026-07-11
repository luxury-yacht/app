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

  const handleHeaderDoubleClick = () => {
    if (!isModalOpen()) {
      WindowToggleMaximise();
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: The desktop titlebar double-click gesture toggles the native window state, while the controls boundary prevents that gesture from swallowing native button activation.
    <header
      className={`app-header${isMac ? ' app-header--mac' : ''}`}
      onDoubleClick={handleHeaderDoubleClick}
      data-app-region="header"
    >
      {/** biome-ignore lint/a11y/noStaticElementInteractions: The desktop titlebar double-click gesture toggles the native window state, while the controls boundary prevents that gesture from swallowing native button activation. */}
      <div className="app-header-controls" onDoubleClick={(e) => e.stopPropagation()}>
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

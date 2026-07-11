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

  const handleHeaderDoubleClick = (event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest('button, input, select, textarea, a[href]') && !isModalOpen()) {
      WindowToggleMaximise();
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Empty desktop titlebar space supports the native window double-click gesture; interactive descendants are excluded by the owning handler.
    <header
      className={`app-header${isMac ? ' app-header--mac' : ''}`}
      onDoubleClick={handleHeaderDoubleClick}
      data-app-region="header"
    >
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

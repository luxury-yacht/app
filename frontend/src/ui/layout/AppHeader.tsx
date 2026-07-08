/**
 * frontend/src/ui/layout/AppHeader.tsx
 *
 * Module source for AppHeader.
 * Implements AppHeader logic for the UI layer.
 */

import React from 'react';
import ConnectivityStatus from '@ui/status/ConnectivityStatus';
import MetricsStatus from '@ui/status/MetricsStatus';
import SessionsStatus from '@ui/status/SessionsStatus';
import UpdateStatus from '@ui/status/UpdateStatus';
import FavMenuDropdown from '@ui/favorites/FavMenuDropdown';
import { WindowToggleMaximise } from '@wailsjs/runtime/runtime';
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
    <div
      className={`app-header${isMac ? ' app-header--mac' : ''}`}
      onDoubleClick={handleHeaderDoubleClick}
      data-app-region="header"
    >
      <div className="app-header-controls" onDoubleClick={(e) => e.stopPropagation()}>
        <UpdateStatus />
        <div className="status-indicators">
          <ConnectivityStatus />
          <MetricsStatus />
          <SessionsStatus />
        </div>
        <FavMenuDropdown lastHeaderControl />
      </div>
    </div>
  );
};

export default React.memo(AppHeader);

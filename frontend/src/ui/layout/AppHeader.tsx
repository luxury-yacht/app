import { SearchIcon } from '@shared/components/icons/SharedIcons';
import FavMenuDropdown from '@ui/favorites/FavMenuDropdown';
import ConnectivityStatus from '@ui/status/ConnectivityStatus';
import MetricsStatus from '@ui/status/MetricsStatus';
import SessionsStatus from '@ui/status/SessionsStatus';
import UpdateStatus from '@ui/status/UpdateStatus';
import React from 'react';
import { eventBus } from '@/core/events';
import { isMacPlatform, usesCustomWindowFrame } from '@/utils/platform';
import AppMenuBar from './AppMenuBar';
import WindowHeader from './WindowHeader';

const AppHeader: React.FC = () => (
  <WindowHeader leading={usesCustomWindowFrame() ? <AppMenuBar /> : null}>
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
        title={`Command Palette (${isMacPlatform() ? '⇧⌘P' : 'Ctrl+Shift+P'})`}
        aria-label="Command Palette"
      >
        <SearchIcon width={14} height={14} />
      </button>
    </div>
  </WindowHeader>
);

export default React.memo(AppHeader);

/**
 * frontend/src/ui/layout/AppHeader.tsx
 *
 * Module source for AppHeader.
 * Implements AppHeader logic for the UI layer.
 */

import React from 'react';
import KubeconfigSelector from '@shared/components/KubeconfigSelector';
import ConnectivityStatus from '@components/status/ConnectivityStatus';
import MetricsStatus from '@components/status/MetricsStatus';
import SessionsStatus from '@components/status/SessionsStatus';
import { useViewState } from '@core/contexts/ViewStateContext';
import { WindowToggleMaximise } from '@wailsjs/runtime/runtime';
import { SettingsIcon } from '@shared/components/icons/MenuIcons';
import logo from '@assets/captain-k8s-color.png';
import { isMacPlatform } from '@/utils/platform';
import './AppHeader.css';

interface AppHeaderProps {
  contentTitle: string;
  onAboutClick?: () => void;
}

const AppHeader: React.FC<AppHeaderProps> = ({ contentTitle, onAboutClick }) => {
  const viewState = useViewState();

  const isMac = isMacPlatform();

  return (
    <div
      className={`app-header${isMac ? ' app-header--mac' : ''}`}
      onDoubleClick={() => WindowToggleMaximise()}
    >
      <div className="app-header-left">
        <img
          src={logo}
          alt="Luxury Yacht"
          className="app-header-logo"
          onClick={onAboutClick}
          style={{ cursor: onAboutClick ? 'pointer' : 'default' }}
          title="About Luxury Yacht"
        />
      </div>
      <div className="app-header-center">
        <span className="app-header-title">
          {contentTitle.split(' • ').map((segment, index, arr) => {
            const separatorIndex = segment.indexOf(': ');
            const hasLabel = separatorIndex > -1;
            const label = hasLabel ? segment.slice(0, separatorIndex) : segment;
            const value = hasLabel ? segment.slice(separatorIndex + 2) : '';
            return (
              <span key={`${label}-${index}`} className="app-header-segment">
                {hasLabel ? (
                  <>
                    <span className="app-header-label">{label}:</span>{' '}
                    <span className="app-header-value">{value}</span>
                  </>
                ) : (
                  <span className="app-header-value">{label}</span>
                )}
                {index < arr.length - 1 ? (
                  <span className="app-header-separator">&nbsp;&nbsp;&nbsp;&nbsp;</span>
                ) : null}
              </span>
            );
          })}
        </span>
      </div>

      <div className="app-header-controls" onDoubleClick={(e) => e.stopPropagation()}>
        <div className="status-indicators">
          <ConnectivityStatus />
          <MetricsStatus />
          <SessionsStatus />
        </div>
        <KubeconfigSelector />
        <button
          className="settings-button"
          onClick={() => viewState.setIsSettingsOpen(true)}
          title="Settings"
          aria-label="Settings"
        >
          <SettingsIcon width={20} height={20} />
        </button>
      </div>
    </div>
  );
};

export default React.memo(AppHeader);

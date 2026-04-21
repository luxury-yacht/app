/**
 * frontend/src/ui/layout/AppHeader.tsx
 *
 * Module source for AppHeader.
 * Implements AppHeader logic for the UI layer.
 */

import React from 'react';
import KubeconfigSelector from '@shared/components/KubeconfigSelector';
import ConnectivityStatus from '@ui/status/ConnectivityStatus';
import MetricsStatus from '@ui/status/MetricsStatus';
import SessionsStatus from '@ui/status/SessionsStatus';
import FavMenuDropdown from '@ui/favorites/FavMenuDropdown';
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
  const activateOnEnterOrSpace = (
    event: React.KeyboardEvent<HTMLElement>,
    onActivate: () => void
  ) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    onActivate();
  };

  return (
    <div
      className={`app-header${isMac ? ' app-header--mac' : ''}`}
      onDoubleClick={() => WindowToggleMaximise()}
      data-app-region="header"
    >
      <div className="app-header-left">
        <div
          className="app-header-about-button"
          onClick={onAboutClick}
          onKeyDown={(event) =>
            activateOnEnterOrSpace(event, () => {
              onAboutClick?.();
            })
          }
          aria-label="About Luxury Yacht"
          title="About Luxury Yacht"
          role="button"
          tabIndex={0}
        >
          <img src={logo} alt="" className="app-header-logo" />
        </div>
      </div>
      <div className="app-header-center">
        <span className="app-header-title">
          {contentTitle.split(' • ').map((segment, index) => {
            const separatorIndex = segment.indexOf(': ');
            const hasLabel = separatorIndex > -1;
            const label = hasLabel ? segment.slice(0, separatorIndex) : segment;
            const value = hasLabel ? segment.slice(separatorIndex + 2) : '';
            return (
              <span key={`${label}-${index}`} className="app-header-segment">
                {hasLabel ? (
                  <>
                    <span className="app-header-label">{label}</span>{' '}
                    <span className="app-header-value">{value}</span>
                  </>
                ) : (
                  <span className="app-header-value">{label}</span>
                )}
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
        <FavMenuDropdown />
        <div
          className="settings-button"
          onClick={() => viewState.setIsSettingsOpen(true)}
          onKeyDown={(event) =>
            activateOnEnterOrSpace(event, () => {
              viewState.setIsSettingsOpen(true);
            })
          }
          title="Settings"
          aria-label="Settings"
          role="button"
          tabIndex={0}
          data-app-header-last-focusable="true"
        >
          <SettingsIcon width={20} height={20} />
        </div>
      </div>
    </div>
  );
};

export default React.memo(AppHeader);

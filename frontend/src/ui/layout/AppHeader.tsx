import React from 'react';
import KubeconfigSelector from '@shared/components/KubeconfigSelector';
import RefreshStatusIndicator from '@components/refresh/RefreshStatusIndicator';
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
        <span className="app-header-title">{contentTitle}</span>
      </div>

      <div className="app-header-controls" onDoubleClick={(e) => e.stopPropagation()}>
        <RefreshStatusIndicator />
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

/**
 * frontend/src/ui/layout/AppHeader.tsx
 *
 * Module source for AppHeader.
 * Implements AppHeader logic for the UI layer.
 */

import {
  closeWindow,
  isWindowMaximised,
  minimiseWindow,
  toggleMaximise,
} from '@core/desktop-runtime';
import { SearchIcon } from '@shared/components/icons/SharedIcons';
import FavMenuDropdown from '@ui/favorites/FavMenuDropdown';
import ConnectivityStatus from '@ui/status/ConnectivityStatus';
import MetricsStatus from '@ui/status/MetricsStatus';
import SessionsStatus from '@ui/status/SessionsStatus';
import UpdateStatus from '@ui/status/UpdateStatus';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { eventBus } from '@/core/events';
import { reportOperationalError } from '@/utils/errorHandler';
import { isMacPlatform, isWindowsPlatform, usesCustomWindowFrame } from '@/utils/platform';
import './AppHeader.css';
import AppMenuBar from './AppMenuBar';
import { installDirectionalWindowResizeCursor } from './windowResizeCursor';
import './windowResizeCursor.css';

interface AppHeaderProps {
  mode?: 'workspace' | 'panel';
}

interface AppHeaderClassOptions {
  isMac: boolean;
  isLinux: boolean;
  usesCustomFrame: boolean;
}

interface MaximiseControlPresentation {
  ariaLabel: string;
  title: string;
  path: string;
}

const buildAppHeaderClassName = ({ isMac, isLinux, usesCustomFrame }: AppHeaderClassOptions) =>
  [
    'app-header',
    isMac ? 'app-header--mac' : '',
    isLinux ? 'app-header--linux' : '',
    usesCustomFrame ? 'app-header--custom-frame' : '',
  ]
    .filter(Boolean)
    .join(' ');

const getMaximiseControlPresentation = (isMaximised: boolean): MaximiseControlPresentation => {
  if (isMaximised) {
    return {
      ariaLabel: 'Restore window',
      title: 'Restore',
      path: 'M5.5 6.5v7h7v-7h-7Zm2-2h7v7',
    };
  }
  return {
    ariaLabel: 'Maximise window',
    title: 'Maximise',
    path: 'M6.5 4.5h-2v2M11.5 4.5h2v2M6.5 13.5h-2v-2M11.5 13.5h2v-2',
  };
};

const isModalSurfaceOpen = () =>
  typeof document !== 'undefined' && document.body.classList.contains('modal-surface-open');

const runWindowOperation = (action: string, operation: () => Promise<void>) => {
  void operation().catch((error: unknown) =>
    reportOperationalError(error, { source: 'AppHeader', action })
  );
};

const AppHeader: React.FC<AppHeaderProps> = ({ mode = 'workspace' }) => {
  const isMac = isMacPlatform();
  const isLinux = !isMac && !isWindowsPlatform();
  const usesCustomFrame = usesCustomWindowFrame();
  const [isMaximised, setIsMaximised] = useState(false);
  const maximiseControl = getMaximiseControlPresentation(isMaximised);
  const maximiseStateRequestRef = useRef(0);
  const refreshMaximiseState = useCallback(async () => {
    const request = ++maximiseStateRequestRef.current;
    try {
      const nextState = await isWindowMaximised();
      if (request === maximiseStateRequestRef.current) {
        setIsMaximised(nextState);
      }
    } catch {
      // Storybook and browser-only tests intentionally run without a Wails host.
    }
  }, []);

  useEffect(() => {
    if (!usesCustomFrame) {
      return;
    }

    let resizeTimer: number | undefined;
    const handleResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => void refreshMaximiseState(), 50);
    };

    void refreshMaximiseState();
    window.addEventListener('resize', handleResize);
    return () => {
      maximiseStateRequestRef.current += 1;
      window.clearTimeout(resizeTimer);
      window.removeEventListener('resize', handleResize);
    };
  }, [refreshMaximiseState, usesCustomFrame]);

  useEffect(() => {
    if (!usesCustomFrame) {
      return;
    }
    return installDirectionalWindowResizeCursor();
  }, [usesCustomFrame]);

  const toggleWindowMaximize = useCallback(() => {
    if (isModalSurfaceOpen()) {
      return;
    }
    runWindowOperation('toggle-maximise-window', async () => {
      await toggleMaximise();
      await refreshMaximiseState();
    });
  }, [refreshMaximiseState]);

  const headerClassName = buildAppHeaderClassName({ isMac, isLinux, usesCustomFrame });

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
            void toggleWindowMaximize();
          }
        }}
        onDoubleClick={() => void toggleWindowMaximize()}
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
            data-app-header-last-focusable={usesCustomFrame ? undefined : 'true'}
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
            onClick={() => runWindowOperation('minimise-window', minimiseWindow)}
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
            aria-label={maximiseControl.ariaLabel}
            title={maximiseControl.title}
            onClick={() => void toggleWindowMaximize()}
          >
            <svg
              className="app-header-window-control-glyph"
              viewBox="0 0 18 18"
              aria-hidden="true"
              focusable="false"
            >
              <path d={maximiseControl.path} />
            </svg>
          </button>
          <button
            type="button"
            className="app-header-window-control app-header-window-control--close"
            aria-label="Close window"
            title="Close"
            data-app-header-last-focusable="true"
            onClick={() => runWindowOperation('close-window', closeWindow)}
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

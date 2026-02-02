/**
 * DockablePanelControls.tsx
 *
 * Control buttons for docking, maximizing, and closing a dockable panel.
 *
 * Props:
 * - position: Current dock position of the panel ('floating', 'right', 'bottom').
 * - isMaximized: Whether the panel is currently maximized.
 * - allowMaximize: Whether maximizing the panel is allowed.
 * - onDock: Callback to change the dock position.
 * - onToggleMaximize: Callback to toggle maximization state.
 * - onClose: Callback to close the panel.
 */

import React from 'react';
import type { DockPosition } from './useDockablePanelState';
import {
  DockRightIcon,
  DockBottomIcon,
  FloatPanelIcon,
  MaximizePanelIcon,
  RestorePanelIcon,
  CloseIcon,
} from '@shared/components/icons/MenuIcons';

interface DockablePanelControlsProps {
  position: DockPosition;
  isMaximized: boolean;
  allowMaximize: boolean;
  onDock: (position: DockPosition) => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

// Control buttons for docking, maximizing, and closing the panel.
export const DockablePanelControls: React.FC<DockablePanelControlsProps> = ({
  position,
  isMaximized,
  allowMaximize,
  onDock,
  onToggleMaximize,
  onClose,
}) => {
  return (
    <div className="dockable-panel__controls" onMouseDown={(e) => e.stopPropagation()}>
      {/* When floating, show bottom and right buttons */}
      {!isMaximized && position === 'floating' && (
        <>
          <button
            className="dockable-panel__control-btn"
            onClick={() => onDock('bottom')}
            title="Dock to bottom"
            aria-label="Dock panel to bottom"
          >
            <DockBottomIcon width={20} height={20} />
          </button>
          <button
            className="dockable-panel__control-btn"
            onClick={() => onDock('right')}
            title="Dock to right"
            aria-label="Dock panel to right side"
          >
            <DockRightIcon width={20} height={20} />
          </button>
        </>
      )}
      {/* When docked right, show bottom and float buttons */}
      {!isMaximized && position === 'right' && (
        <>
          <button
            className="dockable-panel__control-btn"
            onClick={() => onDock('bottom')}
            title="Dock to bottom"
            aria-label="Dock panel to bottom"
          >
            <DockBottomIcon width={20} height={20} />
          </button>
          <button
            className="dockable-panel__control-btn"
            onClick={() => onDock('floating')}
            title="Float panel"
            aria-label="Undock panel to floating window"
          >
            <FloatPanelIcon width={20} height={20} />
          </button>
        </>
      )}
      {/* When docked bottom, show right and float buttons */}
      {!isMaximized && position === 'bottom' && (
        <>
          <button
            className="dockable-panel__control-btn"
            onClick={() => onDock('right')}
            title="Dock to right"
            aria-label="Dock panel to right side"
          >
            <DockRightIcon width={20} height={20} />
          </button>
          <button
            className="dockable-panel__control-btn"
            onClick={() => onDock('floating')}
            title="Float panel"
            aria-label="Undock panel to floating window"
          >
            <FloatPanelIcon width={20} height={20} />
          </button>
        </>
      )}
      {allowMaximize && (
        <button
          className="dockable-panel__control-btn"
          onClick={onToggleMaximize}
          title={isMaximized ? 'Restore panel' : 'Maximize panel'}
          aria-label={isMaximized ? 'Restore panel size' : 'Maximize panel'}
        >
          {isMaximized ? (
            <RestorePanelIcon width={20} height={20} />
          ) : (
            <MaximizePanelIcon width={20} height={20} />
          )}
        </button>
      )}
      <button
        className="dockable-panel__control-btn dockable-panel__control-btn--close"
        onClick={onClose}
        title="Close panel"
        aria-label="Close panel"
      >
        <CloseIcon />
      </button>
    </div>
  );
};

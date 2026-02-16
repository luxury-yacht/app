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

interface DockAction {
  target: DockPosition;
  title: string;
  ariaLabel: string;
  icon: React.ReactNode;
}

const dockActionsByPosition: Record<DockPosition, DockAction[]> = {
  floating: [
    {
      target: 'bottom',
      title: 'Dock to bottom',
      ariaLabel: 'Dock panel to bottom',
      icon: <DockBottomIcon width={20} height={20} />,
    },
    {
      target: 'right',
      title: 'Dock to right',
      ariaLabel: 'Dock panel to right side',
      icon: <DockRightIcon width={20} height={20} />,
    },
  ],
  right: [
    {
      target: 'bottom',
      title: 'Dock to bottom',
      ariaLabel: 'Dock panel to bottom',
      icon: <DockBottomIcon width={20} height={20} />,
    },
    {
      target: 'floating',
      title: 'Float panel',
      ariaLabel: 'Undock panel to floating window',
      icon: <FloatPanelIcon width={20} height={20} />,
    },
  ],
  bottom: [
    {
      target: 'right',
      title: 'Dock to right',
      ariaLabel: 'Dock panel to right side',
      icon: <DockRightIcon width={20} height={20} />,
    },
    {
      target: 'floating',
      title: 'Float panel',
      ariaLabel: 'Undock panel to floating window',
      icon: <FloatPanelIcon width={20} height={20} />,
    },
  ],
};

// Control buttons for docking, maximizing, and closing the panel.
export const DockablePanelControls: React.FC<DockablePanelControlsProps> = ({
  position,
  isMaximized,
  allowMaximize,
  onDock,
  onToggleMaximize,
  onClose,
}) => {
  const dockActions = dockActionsByPosition[position];

  return (
    <div className="dockable-panel__controls" onMouseDown={(e) => e.stopPropagation()}>
      {/* Dock-position controls are data-driven; order stays position-specific. */}
      {!isMaximized &&
        dockActions.map((action) => (
          <button
            key={`${position}-${action.target}`}
            className="dockable-panel__control-btn"
            onClick={() => onDock(action.target)}
            title={action.title}
            aria-label={action.ariaLabel}
          >
            {action.icon}
          </button>
        ))}
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

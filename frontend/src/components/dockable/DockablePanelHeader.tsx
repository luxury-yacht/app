/**
 * frontend/src/components/dockable/DockablePanelHeader.tsx
 *
 * UI component for DockablePanelHeader.
 * Handles rendering and interactions for the shared components.
 */


import React from 'react';

interface DockablePanelHeaderProps {
  title: string;
  headerContent?: React.ReactNode;
  onMouseDown: (event: React.MouseEvent) => void;
  controls: React.ReactNode;
}

// Panel header with title/content and the controls region.
export const DockablePanelHeader: React.FC<DockablePanelHeaderProps> = ({
  title,
  headerContent,
  onMouseDown,
  controls,
}) => {
  return (
    <div className="dockable-panel__header" onMouseDown={onMouseDown} role="banner">
      <div className="dockable-panel__header-content">
        {headerContent || <span className="dockable-panel__title">{title}</span>}
      </div>
      {controls}
    </div>
  );
};

/**
 * frontend/src/shared/components/tables/GridTableLayout.tsx
 *
 * UI component for GridTableLayout.
 * Handles rendering and interactions for the shared components.
 */

import React from 'react';

interface GridTableLayoutProps {
  embedded: boolean;
  className: string;
  loading: boolean;
  filters?: React.ReactNode;
  header?: React.ReactNode;
  body: React.ReactNode;
  footer?: React.ReactNode;
  loadingOverlay?: React.ReactNode;
  contextMenu?: React.ReactNode;
}

const GridTableLayout: React.FC<GridTableLayoutProps> = ({
  embedded,
  className,
  loading,
  filters,
  header,
  body,
  footer,
  loadingOverlay,
  contextMenu,
}) => {
  const containerClasses = [
    'gridtable-container',
    embedded ? 'embedded' : '',
    footer ? 'has-footer' : '',
    className,
    loading ? 'is-loading' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <div className={containerClasses}>
        {loadingOverlay}
        {filters}
        {header}
        {body}
        {footer}
      </div>
      {contextMenu}
    </>
  );
};

export default GridTableLayout;

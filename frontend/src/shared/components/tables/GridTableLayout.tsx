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
  loadingOverlay,
  contextMenu,
}) => {
  return (
    <>
      <div
        className={`gridtable-container ${embedded ? 'embedded' : ''} ${className} ${
          loading ? 'is-loading' : ''
        }`}
        role="grid"
        aria-busy={loading || undefined}
      >
        {loadingOverlay}
        {filters}
        {header}
        {body}
      </div>
      {contextMenu}
    </>
  );
};

export default GridTableLayout;

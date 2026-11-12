/**
 * frontend/src/shared/components/tables/GridTableLayout.tsx
 *
 * UI component for GridTableLayout.
 * Handles rendering and interactions for the shared components.
 */

import type React from 'react';

interface GridTableLayoutProps {
  embedded: boolean;
  className: string;
  loading: boolean;
  filters?: React.ReactNode;
  header?: React.ReactNode;
  body: React.ReactNode;
  /** Floats over the bottom of the body, above the footer. */
  batchBar?: React.ReactNode;
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
  batchBar,
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
        {batchBar}
        {footer}
      </div>
      {contextMenu}
    </>
  );
};

export default GridTableLayout;

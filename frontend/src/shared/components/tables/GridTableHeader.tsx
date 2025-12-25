/**
 * frontend/src/shared/components/tables/GridTableHeader.tsx
 *
 * UI component for GridTableHeader.
 * Handles rendering and interactions for the shared components.
 */

import React from 'react';
import type { RefObject } from 'react';

interface GridTableHeaderProps {
  headerInnerRef: RefObject<HTMLDivElement | null>;
  tableClassName: string;
  useShortNames: boolean;
  scrollbarWidth: number;
  headerRow: React.ReactNode;
  hideHeader: boolean;
}

const GridTableHeader: React.FC<GridTableHeaderProps> = ({
  headerInnerRef,
  tableClassName,
  useShortNames,
  scrollbarWidth,
  headerRow,
  hideHeader,
}) => {
  if (hideHeader) {
    return null;
  }

  return (
    <div
      className="gridtable-header-container"
      style={scrollbarWidth > 0 ? { paddingRight: `${scrollbarWidth}px` } : undefined}
    >
      <div
        ref={headerInnerRef}
        className={`gridtable gridtable--header ${tableClassName} ${useShortNames ? 'short-names' : ''}`}
      >
        {headerRow}
      </div>
    </div>
  );
};

export default GridTableHeader;

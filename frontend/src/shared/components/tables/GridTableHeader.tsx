/**
 * frontend/src/shared/components/tables/GridTableHeader.tsx
 *
 * UI component for GridTableHeader.
 * Handles rendering and interactions for the shared components.
 */

import type React from 'react';
import type { RefObject } from 'react';

interface GridTableHeaderProps {
  headerInnerRef: RefObject<HTMLTableElement | null>;
  tableClassName: string;
  useShortNames: boolean;
  scrollbarWidth: number;
  headerRow: React.ReactNode;
  hideHeader: boolean;
  trailingBoundaryOffset: number | null;
}

const GridTableHeader: React.FC<GridTableHeaderProps> = ({
  headerInnerRef,
  tableClassName,
  useShortNames,
  scrollbarWidth,
  headerRow,
  hideHeader,
  trailingBoundaryOffset,
}) => {
  if (hideHeader) {
    return null;
  }

  return (
    <div
      className="gridtable-header-container"
      style={scrollbarWidth > 0 ? { paddingRight: `${scrollbarWidth}px` } : undefined}
    >
      <table
        ref={headerInnerRef}
        className={`gridtable gridtable--header ${tableClassName} ${useShortNames ? 'short-names' : ''}`}
      >
        <thead>{headerRow}</thead>
      </table>
      {trailingBoundaryOffset !== null && (
        <div
          className="gridtable-trailing-boundary gridtable-trailing-boundary--header"
          style={{ left: `${trailingBoundaryOffset}px` }}
          aria-hidden="true"
        />
      )}
    </div>
  );
};

export default GridTableHeader;

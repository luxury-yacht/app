/**
 * frontend/src/shared/components/tables/GridTableInitialLoading.tsx
 *
 * UI component for GridTableInitialLoading.
 * Handles rendering and interactions for the shared components.
 */

import LoadingSpinner from '@shared/components/LoadingSpinner';
import type React from 'react';

interface GridTableInitialLoadingProps {
  embedded: boolean;
  className: string;
  message?: string;
}

const GridTableInitialLoading: React.FC<GridTableInitialLoadingProps> = ({
  embedded,
  className,
  message = 'Loading resources...',
}) => (
  <div
    className={`gridtable-container gridtable-initial-loading ${embedded ? 'embedded' : ''} ${className}`}
  >
    <div className="gridtable-loading-overlay">
      <LoadingSpinner message={message} />
    </div>
  </div>
);

export default GridTableInitialLoading;

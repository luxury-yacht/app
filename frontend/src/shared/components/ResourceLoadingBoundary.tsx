import React, { useMemo, useEffect } from 'react';
import LoadingSpinner from './LoadingSpinner';

interface ResourceLoadingBoundaryProps {
  loading: boolean;
  dataLength: number;
  hasLoaded?: boolean;
  spinnerMessage?: string;
  allowPartial?: boolean;
  suppressEmptyWarning?: boolean;
  children: React.ReactNode;
}

const ResourceLoadingBoundary: React.FC<ResourceLoadingBoundaryProps> = ({
  loading,
  dataLength,
  hasLoaded = false,
  spinnerMessage,
  allowPartial = false,
  suppressEmptyWarning = false,
  children,
}) => {
  const shouldShowSpinner = useMemo(() => {
    if (!allowPartial) {
      return !hasLoaded || (loading && dataLength === 0);
    }

    const hasAnyData = dataLength > 0;
    const initialLoadComplete = hasLoaded || hasAnyData;
    return !initialLoadComplete;
  }, [allowPartial, dataLength, hasLoaded, loading]);

  useEffect(() => {
    if (!allowPartial || suppressEmptyWarning || !import.meta.env.DEV) {
      return;
    }

    if (!loading && dataLength === 0 && !hasLoaded) {
      console.warn(
        '[ResourceLoadingBoundary] allowPartial is enabled but the dataset is empty after loading completed. Set hasLoaded=true when the empty state is intentional to avoid a persistent spinner.'
      );
    }
  }, [allowPartial, loading, dataLength, hasLoaded, suppressEmptyWarning]);

  if (shouldShowSpinner) {
    return <LoadingSpinner message={spinnerMessage ?? 'Loading resources...'} />;
  }

  return <>{children}</>;
};

export default ResourceLoadingBoundary;

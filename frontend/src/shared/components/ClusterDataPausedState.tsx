import React from 'react';
import { CLUSTER_DATA_AUTO_REFRESH_DISABLED_MESSAGE } from '@/core/refresh/loadingPolicy';

interface ClusterDataPausedStateProps {
  className?: string;
}

const ClusterDataPausedState: React.FC<ClusterDataPausedStateProps> = ({ className }) => {
  return (
    <div className={className} role="status">
      {CLUSTER_DATA_AUTO_REFRESH_DISABLED_MESSAGE}
    </div>
  );
};

export default ClusterDataPausedState;

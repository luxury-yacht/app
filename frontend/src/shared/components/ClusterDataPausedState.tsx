import type React from 'react';
import { CLUSTER_DATA_AUTO_REFRESH_DISABLED_MESSAGE } from '@/core/refresh/loadingPolicy';

interface ClusterDataPausedStateProps {
  className?: string;
}

const ClusterDataPausedState: React.FC<ClusterDataPausedStateProps> = ({ className }) => {
  return <output className={className}>{CLUSTER_DATA_AUTO_REFRESH_DISABLED_MESSAGE}</output>;
};

export default ClusterDataPausedState;

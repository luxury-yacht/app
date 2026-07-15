import type { GlobalViewType } from '@/types/navigation/views';
import GlobalViewClusters from './GlobalViewClusters';
import GlobalViewNamespaces from './GlobalViewNamespaces';

interface GlobalViewsProps {
  activeView: GlobalViewType;
}

export default function GlobalViews({ activeView }: GlobalViewsProps) {
  return (
    <div className="view-content">
      {activeView === 'fleet' ? <GlobalViewClusters /> : <GlobalViewNamespaces />}
    </div>
  );
}

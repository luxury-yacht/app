import type { KubeconfigDiscoveryState } from '@modules/kubernetes/config/KubeconfigContext';
import type { ReactNode } from 'react';
import { isMacPlatform } from '@/utils/platform';
import type { ClusterSelectionPhase } from './clusterSelectionPhase';

interface ClusterSelectionOverlayProps {
  phase: ClusterSelectionPhase;
  discoveryState: KubeconfigDiscoveryState;
  searchPaths: string[];
  onOpenKubeconfigSettings: () => void;
}

export const ClusterSelectionOverlay = ({
  phase,
  discoveryState,
  searchPaths,
  onOpenKubeconfigSettings,
}: ClusterSelectionOverlayProps) => {
  if (phase !== 'empty') {
    return null;
  }
  let message: ReactNode = (
    <>
      No active clusters. Press <kbd>{isMacPlatform() ? '⌘' : 'Ctrl'}</kbd>+<kbd>O</kbd> or click
      Open Cluster.
    </>
  );
  const kubeconfigDiscoveryMessage =
    discoveryState === 'search_paths_missing'
      ? 'None of the configured search paths exist.'
      : discoveryState === 'no_kubeconfigs'
        ? 'No kubeconfig files were found in the configured search paths.'
        : null;
  if (kubeconfigDiscoveryMessage) {
    message = (
      <>
        <div>⚠️ {kubeconfigDiscoveryMessage}</div>
        <ul className="no-active-clusters-paths">
          {searchPaths.map((path) => (
            <li key={path}>
              <code>{path}</code>
            </li>
          ))}
        </ul>
        <div className="no-active-clusters-settings-hint">
          Go to{' '}
          <button
            type="button"
            className="no-active-clusters-settings-link"
            onClick={onOpenKubeconfigSettings}
          >
            Settings -&gt; Kubeconfigs
          </button>{' '}
          to modify the list of search paths.
        </div>
      </>
    );
  }
  return (
    <div className="no-active-clusters-overlay" role="status">
      <div className="no-active-clusters-message">{message}</div>
    </div>
  );
};

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
  let kubeconfigDiscoveryMessage: string | null = null;
  if (discoveryState === 'search_paths_missing') {
    kubeconfigDiscoveryMessage = 'None of the kubeconfig search paths exist.';
  } else if (discoveryState === 'no_kubeconfigs') {
    kubeconfigDiscoveryMessage = 'No kubeconfig files were found in the configured search paths.';
  }
  if (kubeconfigDiscoveryMessage) {
    message = (
      <>
        <div>
          <strong>⚠️ {kubeconfigDiscoveryMessage}</strong>
        </div>
        <div className="no-active-clusters-settings-hint">
          One of these paths must contain a valid kubeconfig file:
        </div>
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
    <div className="no-active-clusters-overlay" aria-live="polite" aria-atomic="true">
      <div className="no-active-clusters-message">{message}</div>
    </div>
  );
};

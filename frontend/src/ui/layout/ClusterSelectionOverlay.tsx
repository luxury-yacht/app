import type { KubeconfigDiscoveryState } from '@modules/kubernetes/config/KubeconfigContext';
import type { ReactNode } from 'react';
import { isMacPlatform } from '@/utils/platform';
import type { ClusterSelectionPhase } from './clusterSelectionPhase';

interface ClusterSelectionOverlayProps {
  phase: ClusterSelectionPhase;
  discoveryState: KubeconfigDiscoveryState;
  searchPaths: string[];
}

export const ClusterSelectionOverlay = ({
  phase,
  discoveryState,
  searchPaths,
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
  if (discoveryState === 'search_paths_missing') {
    message = (
      <>
        None of the configured kubeconfig search paths exist. Add a directory in Settings →
        Kubeconfigs.
      </>
    );
  } else if (discoveryState === 'no_kubeconfigs') {
    message = (
      <>
        <div>No kubeconfig files were found in the configured search paths.</div>
        <ul className="no-active-clusters-paths">
          {searchPaths.map((path) => (
            <li key={path}>
              <code>{path}</code>
            </li>
          ))}
        </ul>
      </>
    );
  }
  return (
    <div className="no-active-clusters-overlay" role="status">
      <div className="no-active-clusters-message">{message}</div>
    </div>
  );
};

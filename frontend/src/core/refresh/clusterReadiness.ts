import { clusterWorkspaceStore } from '@/core/cluster-workspace/clusterWorkspaceStore';
import { eventBus } from '@/core/events';

// Keep the internal event boundary as an input adapter for refresh/capability
// tests and non-Wails producers; the workspace store remains the state owner.
eventBus.on('cluster:lifecycle', ({ clusterId, state }) => {
  clusterWorkspaceStore.applyLifecycleState(clusterId, state);
});

export const clusterReadiness = {
  isServiceable: (clusterId: string | null | undefined) =>
    clusterWorkspaceStore.isServiceable(clusterId),
  beginForegroundActivation: (clusterId: string) =>
    clusterWorkspaceStore.beginForegroundActivation(clusterId),
  endForegroundActivation: (clusterId: string) =>
    clusterWorkspaceStore.endForegroundActivation(clusterId),
  onBecameServiceable: (listener: (clusterId: string) => void) =>
    clusterWorkspaceStore.onBecameServiceable(listener),
  onForegroundActivationStarted: (listener: (clusterId: string) => void) =>
    clusterWorkspaceStore.onForegroundActivationStarted(listener),
  resetForTests: () => clusterWorkspaceStore.resetForTests(),
};

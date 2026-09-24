package backend

import (
	"context"
	"errors"
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/logsources"
)

func (a *WorkspaceCoordinator) initializeSelectedClustersAtStartup() (int, context.Context, error) {
	snapshot, settingsErr := a.preferences.EnsureLoadedForStartup()
	if settingsErr != nil {
		return 0, nil, settingsErr
	}
	if snapshot.Provenance == PreferencesStartupDefault {
		a.logger.Info("Initialized app settings with defaults", logsources.App)
	} else {
		a.logger.Debug("Application settings loaded successfully", logsources.App)
	}

	selectedCount := 0
	var connectionCtx context.Context
	err := a.runSelectionMutation("startup-initialize-selected-clusters", func(mutation *selectionMutation) error {
		a.restoreKubeconfigSelection()
		selectedCount = len(a.GetSelectedKubeconfigs())
		connectionCtx = mutation.context()
		return nil
	})
	return selectedCount, connectionCtx, err
}

func (a *WorkspaceCoordinator) connectSelectedClustersAtStartup(ctx context.Context) error {
	if ctx == nil {
		ctx = a.CtxOrBackground()
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	selectedCount := len(a.GetSelectedKubeconfigs())
	if selectedCount == 0 {
		return nil
	}
	a.logger.Info(fmt.Sprintf("Connecting to %d selected cluster(s)", selectedCount), logsources.App)
	if a.kubeClientInitializer != nil {
		return a.kubeClientInitializer(ctx)
	}
	selections, clientErr := a.preflightSelectedClusterClients(ctx)
	if len(selections) == 0 {
		return clientErr
	}

	// Client preflight is cancellable and runs outside the selection lock. The
	// publication phase re-enters the boundary so stale startup work cannot race
	// a newer tab selection's refresh and catalog state.
	a.selectionMutationMu.Lock()
	defer a.selectionMutationMu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	return errors.Join(clientErr, a.finishKubernetesClientInitialization(ctx, selections))
}

func (a *WorkspaceCoordinator) preflightSelectedClusterClients(ctx context.Context) ([]kubeconfigSelection, error) {
	a.logger.Info("Initializing Kubernetes client", logsources.KubernetesClient)

	selections, err := a.selectedKubeconfigSelections()
	if err != nil {
		return nil, err
	}
	if len(selections) == 0 {
		return nil, fmt.Errorf("no kubeconfig selections available")
	}

	return selections, a.syncClusterClientPoolWithContext(ctx, selections)
}

func (a *WorkspaceCoordinator) finishKubernetesClientInitialization(
	ctx context.Context,
	selections []kubeconfigSelection,
) error {
	if err := a.publishConnectedClusterSelections(selections); err != nil {
		a.logger.ErrorWithCause(err, "Failed to initialise refresh subsystem", logsources.Refresh)
		return fmt.Errorf("failed to initialise refresh subsystem: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	a.startObjectCatalog()

	a.logger.Info(fmt.Sprintf("Successfully established Kubernetes clients for %d cluster(s)", len(selections)), logsources.KubernetesClient)
	// Note: Global connection status tracking has been removed. Connection health
	// is now tracked per-cluster via cluster:health:* and cluster:auth:* events.

	return nil
}

func (a *WorkspaceCoordinator) restoreKubeconfigSelection() {
	savedSelections := a.preferences.SelectedKubeconfigs()

	var normalized []string
	if len(savedSelections) > 0 {
		normalized = make([]string, 0, len(savedSelections))
	}
	for _, selection := range savedSelections {
		parsed, err := a.clusterRuntime.resolveKubeconfigSelection(selection)
		if err != nil {
			continue
		}
		normalized = append(normalized, parsed.String())
	}

	a.kubeconfigsMu.Lock()
	a.setSelectedKubeconfigsLocked(normalized)
	a.kubeconfigsMu.Unlock()
	a.replaceWorkspaceSelections(normalized)

	if len(normalized) > 0 {
		a.preferences.SetSelectedKubeconfigsSnapshot(normalized)
	}
}

// Admission retains failed tabs, while refresh only publishes installed clients.
// A failed sibling must neither block healthy routes nor retain deselected ones.
func (a *WorkspaceCoordinator) publishConnectedClusterSelections(selections []kubeconfigSelection) error {
	connected := make([]kubeconfigSelection, 0, len(selections))
	for _, selection := range selections {
		meta := a.clusterRuntime.clusterMetaForSelection(selection)
		if a.clusterRuntime.clusterClientsForID(meta.ID) != nil || a.clusterRuntime.clusterClientsForSelection(selection) != nil {
			connected = append(connected, selection)
		}
	}
	if len(connected) == 0 {
		a.refresh.teardownRefreshSubsystem()
		return nil
	}
	return a.refresh.updateRefreshSubsystemSelections(connected)
}

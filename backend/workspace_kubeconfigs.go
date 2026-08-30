package backend

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
)

// SetKubeconfigSearchPaths persists the search paths and refreshes kubeconfig discovery.
func (a *WorkspaceCoordinator) SetKubeconfigSearchPaths(paths []string) error {
	return a.runSelectionMutation("set-kubeconfig-search-paths", func(mutation *selectionMutation) error {
		normalized := normalizeKubeconfigSearchPaths(paths)
		if len(normalized) == 0 {
			return fmt.Errorf("at least one kubeconfig search path is required")
		}

		if err := a.preferences.SaveKubeconfigSearchPaths(normalized); err != nil {
			return err
		}

		a.refreshKubeconfigDiscoveryAfterSearchPathChange()
		return nil
	})
}

func (a *WorkspaceCoordinator) refreshKubeconfigDiscoveryAfterSearchPathChange() {
	if err := a.clusterRuntime.refreshKubeconfigDiscoveryAndWatch(); err != nil {
		a.logger.Warn(fmt.Sprintf("Failed to refresh kubeconfig discovery: %v", err), logsources.KubeconfigManager)
	}
	a.pruneSelectionsAgainstDiscoveredKubeconfigs()
}

// GetSelectedKubeconfigs returns the active kubeconfig selections for multi-cluster support.
func (a *WorkspaceCoordinator) GetSelectedKubeconfigs() []string {
	a.kubeconfigsMu.RLock()
	defer a.kubeconfigsMu.RUnlock()
	if len(a.selectedKubeconfigs) > 0 {
		return append([]string(nil), a.selectedKubeconfigs...)
	}
	return []string{}
}

// setSelectedKubeconfigsLocked updates the selection snapshot. The caller must
// hold kubeconfigsMu so the value and workspace revision commit together.
func (a *WorkspaceCoordinator) setSelectedKubeconfigsLocked(selections []string) {
	a.selectedKubeconfigs = append([]string(nil), selections...)
	a.clusterWorkspace.markClusterWorkspaceChanged()
}

// SetKubeconfig switches to a different kubeconfig file and context
// The parameter should be in the format "path:context"
func (a *WorkspaceCoordinator) SetKubeconfig(selection string) error {
	a.logger.Info(fmt.Sprintf("Switching kubeconfig to: %s", selection), logsources.KubeconfigManager)

	if strings.TrimSpace(selection) == "" {
		return a.SetSelectedKubeconfigs(nil)
	}

	// Delegate to the multi-cluster selection flow to avoid implicit base routing.
	if err := a.SetSelectedKubeconfigs([]string{selection}); err != nil {
		return err
	}

	parsed, err := parseKubeconfigSelection(selection)
	if err == nil {
		a.logger.Info(fmt.Sprintf("Successfully switched to kubeconfig %s with context %s", parsed.Path, parsed.Context), logsources.KubeconfigManager)
	}
	return nil
}

// SetSelectedKubeconfigs updates the active kubeconfig selection set for multi-cluster support.
//
// This function is the primary entry point for changing which Kubernetes clusters the application
// is connected to. It's called by the frontend when the user selects one or more clusters from the UI.
//
// The function performs several critical operations in sequence:
//  1. Validates and normalizes the incoming selection strings
//  2. Persists the selection to disk so it survives app restarts
//  3. Creates/updates Kubernetes API clients for each selected cluster
//  4. Initializes or updates the refresh subsystem (the HTTP server that serves data to the frontend)
//  5. Starts the object catalog service (required for the Browse/All Objects views)
//
// IMPORTANT: This function is called at runtime when the user changes their cluster selection.
// Startup follows the same client, refresh, and object-catalog initialization sequence through
// connectSelectedClustersAtStartup.
func (a *WorkspaceCoordinator) SetSelectedKubeconfigs(selections []string) error {
	return a.runSelectionMutation("set-selected-kubeconfigs", func(mutation *selectionMutation) error {
		return a.setSelectedKubeconfigs(mutation, selections)
	})
}

func (a *WorkspaceCoordinator) setSelectedKubeconfigs(mutation *selectionMutation, selections []string) error {
	intentStart := time.Now()
	intent, err := a.buildSelectionChangeIntent(selections, mutation.generation)
	mutation.phases.intent = time.Since(intentStart)
	if err != nil {
		return err
	}

	if intent.clearSelection {
		return a.clearKubeconfigSelection()
	}

	commitStart := time.Now()
	a.commitSelectionChangeIntent(intent)
	mutation.phases.commit = time.Since(commitStart)
	return a.executeSelectionChangeWork(mutation.context(), intent, &mutation.phases)
}

// CloseCluster atomically tears down runtime operations for a selected cluster
// and removes that cluster from the selected kubeconfig set.
func (a *WorkspaceCoordinator) CloseCluster(selectionOrClusterID string) error {
	target := strings.TrimSpace(selectionOrClusterID)
	if target == "" {
		return fmt.Errorf("cluster selection or ID is required")
	}

	currentSelections := a.GetSelectedKubeconfigs()
	remainingSelections := make([]string, 0, len(currentSelections))
	targetClusterID := target
	found := false
	for _, selection := range currentSelections {
		clusterID := a.clusterIDForSelection(selection)
		if selection == target || clusterID == target {
			if clusterID != "" {
				targetClusterID = clusterID
			}
			found = true
			continue
		}
		remainingSelections = append(remainingSelections, selection)
	}

	if !found {
		if a.operations != nil {
			a.operations.StopCluster(targetClusterID)
		}
		return nil
	}
	return a.SetSelectedKubeconfigs(remainingSelections)
}

func (a *WorkspaceCoordinator) clusterIDForSelection(selection string) string {
	parsed, err := parseKubeconfigSelection(selection)
	if err != nil {
		return ""
	}
	if clients := a.clusterRuntime.clusterClientsForSelection(parsed); clients != nil && clients.meta.ID != "" {
		return clients.meta.ID
	}
	return a.clusterRuntime.clusterMetaForSelection(parsed).ID
}

// buildSelectionChangeIntent parses and validates a requested selection set.
func (a *WorkspaceCoordinator) buildSelectionChangeIntent(selections []string, generation uint64) (selectionChangeIntent, error) {
	intent := selectionChangeIntent{generation: generation}
	if len(selections) == 0 {
		intent.clearSelection = true
		return intent, nil
	}

	a.kubeconfigsMu.RLock()
	previousSelections := append([]string(nil), a.selectedKubeconfigs...)
	a.kubeconfigsMu.RUnlock()

	normalized, normalizedStrings, err := a.normalizeSelectionSet(selections)
	if err != nil {
		return selectionChangeIntent{}, err
	}

	intent.normalizedSelections = normalized
	intent.normalizedSelectionText = normalizedStrings
	intent.selectionChanged = !selectionSetsEqual(previousSelections, normalizedStrings)
	return intent, nil
}

func (a *WorkspaceCoordinator) normalizeSelectionSet(selections []string) ([]kubeconfigSelection, []string, error) {
	normalized := make([]kubeconfigSelection, 0, len(selections))
	normalizedStrings := make([]string, 0, len(selections))
	seenContexts := make(map[string]struct{}, len(selections))
	for _, selection := range selections {
		parsed, err := a.clusterRuntime.normalizeKubeconfigSelection(selection)
		if err != nil {
			return nil, nil, err
		}
		if err := a.clusterRuntime.validateKubeconfigSelection(parsed); err != nil {
			return nil, nil, err
		}
		selectionKey := parsed.String()
		if selectionKey != "" {
			if _, exists := seenContexts[selectionKey]; exists {
				return nil, nil, fmt.Errorf("duplicate selection: %s", selectionKey)
			}
			seenContexts[selectionKey] = struct{}{}
		}
		normalized = append(normalized, parsed)
		normalizedStrings = append(normalizedStrings, selectionKey)
	}
	return normalized, normalizedStrings, nil
}

// commitSelectionChangeIntent applies validated selection state in-memory and to settings.
func (a *WorkspaceCoordinator) commitSelectionChangeIntent(intent selectionChangeIntent) {
	a.kubeconfigsMu.Lock()
	a.setSelectedKubeconfigsLocked(intent.normalizedSelectionText)
	a.kubeconfigsMu.Unlock()

	if err := a.preferences.SaveSelectedKubeconfigs(intent.normalizedSelectionText); err != nil {
		a.logger.Warn(fmt.Sprintf("Failed to save kubeconfig selection: %v", err), logsources.KubeconfigManager)
	}
}

// executeSelectionChangeWork performs client and refresh work for an already-committed intent.
func (a *WorkspaceCoordinator) executeSelectionChangeWork(
	workCtx context.Context,
	intent selectionChangeIntent,
	phases *selectionMutationPhases,
) error {
	if workCtx == nil {
		workCtx = context.Background()
	}
	workCtx, cancel := context.WithTimeout(workCtx, config.KubeconfigSelectionChangeWorkTimeout)
	defer cancel()

	if err := workCtx.Err(); err != nil {
		return err
	}
	if !a.isSelectionGenerationCurrent(intent.generation) {
		a.logger.Debug(
			fmt.Sprintf("Skipping superseded selection work (generation=%d)", intent.generation),
			"KubeconfigManager",
		)
		return nil
	}

	clientSyncStart := time.Now()
	if err := a.syncClusterClientPoolWithContext(workCtx, intent.normalizedSelections); err != nil {
		return err
	}
	if phases != nil {
		phases.clientSync = time.Since(clientSyncStart)
	}
	if err := workCtx.Err(); err != nil {
		return err
	}

	if !intent.selectionChanged {
		return nil
	}

	if err := workCtx.Err(); err != nil {
		return err
	}
	refreshStart := time.Now()
	if err := a.reconcileRefreshSubsystemSelections(intent.normalizedSelections); err != nil {
		return err
	}
	if phases != nil {
		phases.refresh = time.Since(refreshStart)
	}
	if err := workCtx.Err(); err != nil {
		return err
	}

	catalogStart := time.Now()
	a.startObjectCatalog()
	if phases != nil {
		phases.objectCatalog = time.Since(catalogStart)
	}
	return nil
}

func (a *WorkspaceCoordinator) reconcileRefreshSubsystemSelections(selections []kubeconfigSelection) error {
	return a.refresh.updateRefreshSubsystemSelections(selections)
}

// clearKubeconfigSelection clears the active selection and resets client state.
func (a *WorkspaceCoordinator) clearKubeconfigSelection() error {
	a.logger.Info("Clearing kubeconfig selection", logsources.KubeconfigManager)
	a.retainWorkspaceSelections(nil)
	a.kubeconfigsMu.Lock()
	a.setSelectedKubeconfigsLocked(nil)
	a.kubeconfigsMu.Unlock()
	removed := a.clusterRuntime.clearClusterClientPool()
	for _, item := range removed {
		if item.authManager != nil {
			item.authManager.Shutdown()
		}
	}
	for _, item := range removed {
		if a.operations != nil {
			a.operations.StopCluster(item.clusterID)
		}
		a.removeClusterWorkspaceState(item.clusterID)
	}
	a.refresh.teardownRefreshSubsystem()

	if err := a.preferences.SaveSelectedKubeconfigs(nil); err != nil {
		a.logger.Warn(fmt.Sprintf("Failed to save kubeconfig selection: %v", err), logsources.KubeconfigManager)
	}

	return nil
}

// handleKubeconfigChange is called (debounced) when file changes are detected.
func (a *WorkspaceCoordinator) handleKubeconfigChange(changedPaths []string) {
	if len(changedPaths) == 0 {
		return
	}

	if err := a.runSelectionMutation("kubeconfig-watcher-change", func(mutation *selectionMutation) error {
		a.handleKubeconfigChangeLocked(changedPaths, mutation.generation)
		return nil
	}); err != nil {
		a.logger.Warn(fmt.Sprintf("Failed to process kubeconfig file changes: %v", err), logsources.KubeconfigWatcher)
	}
}

// handleKubeconfigChangeLocked processes file watcher mutations under the selection mutation boundary.
func (a *WorkspaceCoordinator) handleKubeconfigChangeLocked(changedPaths []string, generation uint64) {
	a.logger.Info(
		fmt.Sprintf("Kubeconfig file change detected (%d file(s)), refreshing... (generation=%d)", len(changedPaths), generation),
		"KubeconfigWatcher",
	)
	affectedClusterIDs := a.clusterRuntime.affectedKubeconfigClusters(changedKubeconfigPathSet(changedPaths))
	if err := a.clusterRuntime.discoverKubeconfigs(); err != nil {
		a.logger.Warn(fmt.Sprintf("Failed to re-discover kubeconfigs; skipping reconnect/deselect until next event: %v", err), logsources.KubeconfigWatcher)
		return
	}
	a.logKubeconfigDiscoveryComplete()
	if len(affectedClusterIDs) > 0 {
		toRebuild, toDeselect := a.classifyChangedKubeconfigClusters(affectedClusterIDs)
		if len(toDeselect) > 0 {
			a.deselectClusters(toDeselect)
		}
		a.reconnectChangedKubeconfigClusters(toRebuild)
	}
	a.emitEvent(kubeconfigAvailableChangedEventName)
}

func (a *WorkspaceCoordinator) logKubeconfigDiscoveryComplete() {
	count := a.clusterRuntime.availableKubeconfigCount()
	a.logger.Info(fmt.Sprintf("Re-discovery complete, found %d kubeconfig(s)", count), logsources.KubeconfigWatcher)
}

func (a *WorkspaceCoordinator) classifyChangedKubeconfigClusters(clusterIDs []string) ([]string, []string) {
	a.logger.Info(fmt.Sprintf("Processing %d affected cluster(s)", len(clusterIDs)), logsources.KubeconfigWatcher)
	discoverable := a.clusterRuntime.discoverableKubeconfigSelections()
	inspector := kubeconfigFileInspector{cache: make(map[string]kubeconfigFileInspection)}
	var rebuild, deselect []string
	for _, clusterID := range clusterIDs {
		action := a.classifyChangedKubeconfigCluster(clusterID, discoverable, &inspector)
		switch action {
		case changedKubeconfigRebuild:
			rebuild = append(rebuild, clusterID)
		case changedKubeconfigDeselect:
			deselect = append(deselect, clusterID)
		}
	}
	return rebuild, deselect
}

func (a *WorkspaceCoordinator) classifyChangedKubeconfigCluster(
	clusterID string,
	discoverable map[kubeconfigSelectionKey]struct{},
	inspector *kubeconfigFileInspector,
) changedKubeconfigAction {
	clients := a.clusterRuntime.clusterClientsForID(clusterID)
	if clients == nil {
		return changedKubeconfigKeep
	}
	if _, ok := discoverable[newKubeconfigSelectionKey(clients.kubeconfigPath, clients.kubeconfigContext)]; ok {
		return changedKubeconfigRebuild
	}
	return a.classifyInspectedKubeconfig(clients, inspector.inspect(clients.kubeconfigPath))
}

func (a *WorkspaceCoordinator) classifyInspectedKubeconfig(clients *clusterClients, inspection kubeconfigFileInspection) changedKubeconfigAction {
	switch {
	case inspection.missing:
		a.logger.Info(fmt.Sprintf("Kubeconfig file deleted/renamed for cluster %s, deselecting", clients.meta.Name), logsources.KubeconfigWatcher)
		return changedKubeconfigDeselect
	case inspection.loadErr != nil:
		a.logger.Warn(fmt.Sprintf("Kubeconfig file for cluster %s changed but is temporarily unreadable (%v); keeping selection until next event", clients.meta.Name, inspection.loadErr), logsources.KubeconfigWatcher)
		return changedKubeconfigKeep
	case kubeconfigContextExists(inspection, clients.kubeconfigContext):
		a.logger.Info(fmt.Sprintf("Kubeconfig context still present on disk for cluster %s; reconnecting", clients.meta.Name), logsources.KubeconfigWatcher)
		return changedKubeconfigRebuild
	default:
		a.logger.Info(fmt.Sprintf("Kubeconfig context removed/renamed for cluster %s, deselecting", clients.meta.Name), logsources.KubeconfigWatcher)
		return changedKubeconfigDeselect
	}
}

func (a *WorkspaceCoordinator) reconnectChangedKubeconfigClusters(clusterIDs []string) {
	for _, clusterID := range clusterIDs {
		clients := a.clusterRuntime.clusterClientsForID(clusterID)
		if clients == nil {
			continue
		}
		a.logger.Info(fmt.Sprintf("Reconnecting cluster %s after kubeconfig change", clients.meta.Name), logsources.KubeconfigWatcher)
		a.refresh.teardownClusterSubsystem(clusterID)
		a.refresh.rebuildClusterSubsystem(clusterID)
	}
}

// deselectClusters removes the specified cluster IDs from the active selection.
// Caller must run within a coordinated selection mutation boundary.
func (a *WorkspaceCoordinator) deselectClusters(clusterIDs []string) {
	if len(clusterIDs) == 0 {
		return
	}

	type pathContextKey struct {
		path    string
		context string
	}
	removalKeys := make(map[pathContextKey]struct{}, len(clusterIDs))
	for _, selection := range a.clusterRuntime.selectionsForClusterIDs(clusterIDs) {
		removalKeys[pathContextKey{
			path:    kubeconfigPathKey(filepath.Clean(selection.Path)),
			context: selection.Context,
		}] = struct{}{}
	}

	a.kubeconfigsMu.RLock()
	currentSelections := append([]string(nil), a.selectedKubeconfigs...)
	a.kubeconfigsMu.RUnlock()

	var remainingSelections []string
	var remainingParsed []kubeconfigSelection
	for _, sel := range currentSelections {
		parsed, err := parseKubeconfigSelection(sel)
		if err != nil {
			continue
		}
		key := pathContextKey{
			path:    kubeconfigPathKey(filepath.Clean(parsed.Path)),
			context: parsed.Context,
		}
		if _, removed := removalKeys[key]; !removed {
			remainingSelections = append(remainingSelections, sel)
			remainingParsed = append(remainingParsed, parsed)
		}
	}

	a.applySelectionPrune(remainingSelections, remainingParsed, clusterIDs, logsources.KubeconfigWatcher)
}

// pruneSelectionsAgainstDiscoveredKubeconfigs drops active selections that are no longer discoverable.
// Caller must already hold the coordinated selection mutation boundary.
func (a *WorkspaceCoordinator) pruneSelectionsAgainstDiscoveredKubeconfigs() {
	currentSelections := a.GetSelectedKubeconfigs()
	if len(currentSelections) == 0 {
		return
	}

	prune := a.classifyDiscoveredSelections(currentSelections)
	if len(prune.remainingSelections) == len(currentSelections) {
		return
	}

	a.applySelectionPrune(prune.remainingSelections, prune.remainingParsed, prune.removedClusterIDs, logsources.KubeconfigManager)
}

func (a *WorkspaceCoordinator) classifyDiscoveredSelections(currentSelections []string) discoveredSelectionPrune {
	result := discoveredSelectionPrune{
		remainingSelections: make([]string, 0, len(currentSelections)),
		remainingParsed:     make([]kubeconfigSelection, 0, len(currentSelections)),
	}
	removedSeen := make(map[string]struct{})

	for _, raw := range currentSelections {
		parsed, err := parseKubeconfigSelection(raw)
		if err != nil {
			continue
		}
		if a.clusterRuntime.validateKubeconfigSelection(parsed) == nil {
			result.remainingSelections = append(result.remainingSelections, parsed.String())
			result.remainingParsed = append(result.remainingParsed, parsed)
			continue
		}
		appendUniqueClusterID(&result.removedClusterIDs, removedSeen, a.clusterIDForRemovedSelection(parsed))
	}
	return result
}

func (a *WorkspaceCoordinator) clusterIDForRemovedSelection(selection kubeconfigSelection) string {
	if clients := a.clusterRuntime.clusterClientsForSelection(selection); clients != nil && clients.meta.ID != "" {
		return clients.meta.ID
	}
	return a.clusterRuntime.clusterMetaForSelection(selection).ID
}

// applySelectionPrune commits an already-computed selection prune and tears down removed cluster state.
// Caller must already hold the coordinated selection mutation boundary.
func (a *WorkspaceCoordinator) applySelectionPrune(
	remainingSelections []string,
	remainingParsed []kubeconfigSelection,
	removedClusterIDs []string,
	logComponent string,
) {
	if len(remainingParsed) > 0 {
		if err := a.refresh.updateRefreshSubsystemSelections(remainingParsed); err != nil {
			a.logger.Warn(fmt.Sprintf("Failed to reconcile refresh subsystems after deselect, aborting: %v", err), logComponent)
			return
		}
	} else {
		a.refresh.teardownRefreshSubsystem()
	}

	a.retainWorkspaceSelections(remainingSelections)
	a.kubeconfigsMu.Lock()
	a.setSelectedKubeconfigsLocked(remainingSelections)
	a.kubeconfigsMu.Unlock()

	removed := a.clusterRuntime.removeClusterClients(removedClusterIDs)
	for _, item := range removed {
		if item.authManager != nil {
			item.authManager.Shutdown()
		}
	}
	for _, id := range removedClusterIDs {
		if a.operations != nil {
			a.operations.StopCluster(id)
		}
		a.removeClusterWorkspaceState(id)
	}

	if err := a.preferences.SaveSelectedKubeconfigs(remainingSelections); err != nil {
		a.logger.Warn(fmt.Sprintf("Failed to save updated selection: %v", err), logComponent)
	}
}

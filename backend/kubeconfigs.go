package backend

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/wailsapp/wails/v3/pkg/application"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
)

const clusterDisconnectedReason = "cluster disconnected"

type KubeconfigDiscoveryState string

const (
	KubeconfigDiscoveryStateAvailable          KubeconfigDiscoveryState = "available"
	KubeconfigDiscoveryStateSearchPathsMissing KubeconfigDiscoveryState = "search_paths_missing"
	KubeconfigDiscoveryStateNoKubeconfigs      KubeconfigDiscoveryState = "no_kubeconfigs"
)

type KubeconfigDiscoveryResult struct {
	Kubeconfigs []KubeconfigInfo         `json:"kubeconfigs"`
	State       KubeconfigDiscoveryState `json:"state"`
	SearchPaths []string                 `json:"searchPaths"`
}

type kubeconfigWatchDirectory struct {
	dir         string
	unfiltered  bool
	filterFiles map[string]struct{}
}

type discoveredSelectionPrune struct {
	remainingSelections []string
	remainingParsed     []kubeconfigSelection
	removedClusterIDs   []string
}

// discoverKubeconfigs scans configured kubeconfig search paths for kubeconfig files.
func (a *App) discoverKubeconfigs() error {
	a.kubeconfigsMu.Lock()
	defer a.kubeconfigsMu.Unlock()
	return a.discoverKubeconfigsLocked()
}

func (a *App) discoverKubeconfigsLocked() error {
	a.logger.Debug("Starting kubeconfig discovery", logsources.KubeconfigManager)
	a.availableKubeconfigs = []KubeconfigInfo{}
	a.kubeconfigSearchPaths = []string{}
	a.kubeconfigDiscoveryState = KubeconfigDiscoveryStateNoKubeconfigs

	searchPaths, err := a.loadKubeconfigSearchPaths()
	if err != nil {
		a.logger.ErrorWithCause(err, "Failed to load kubeconfig search paths", logsources.KubeconfigManager)
		return err
	}
	a.kubeconfigSearchPaths = append([]string(nil), searchPaths...)
	if len(searchPaths) == 0 {
		a.logger.Warn("No kubeconfig search paths configured", logsources.KubeconfigManager)
		a.kubeconfigDiscoveryState = KubeconfigDiscoveryStateSearchPathsMissing
		return nil
	}

	defaultConfigPath := resolveKubeconfigSearchPath(filepath.Join("~", ".kube", "config"))
	foundRoot := false
	seenFiles := make(map[string]struct{})

	for _, entry := range searchPaths {
		foundRoot = a.discoverKubeconfigsAtPath(entry, defaultConfigPath, seenFiles) || foundRoot
	}

	if !foundRoot {
		a.kubeconfigDiscoveryState = KubeconfigDiscoveryStateSearchPathsMissing
		return nil
	}
	if len(a.availableKubeconfigs) > 0 {
		a.kubeconfigDiscoveryState = KubeconfigDiscoveryStateAvailable
	}

	return nil
}

func (a *App) discoverKubeconfigsAtPath(entry, defaultConfigPath string, seenFiles map[string]struct{}) bool {
	resolved := resolveKubeconfigSearchPath(entry)
	if resolved == "" {
		return false
	}
	info, err := os.Stat(resolved)
	if err != nil {
		a.logKubeconfigPathReadError(resolved, err)
		return false
	}
	if !info.IsDir() {
		a.appendKubeconfigFromFile(resolved, filepath.Base(resolved), defaultConfigPath, false, seenFiles)
		return true
	}

	a.logger.Debug(fmt.Sprintf("Scanning directory: %s", resolved), logsources.KubeconfigManager)
	entries, err := os.ReadDir(resolved)
	if err != nil {
		a.logger.Warn(fmt.Sprintf("Failed to read kubeconfig directory %s: %v", resolved, err), logsources.KubeconfigManager)
		return true
	}
	a.logger.Debug(fmt.Sprintf("Found %d items in %s", len(entries), resolved), logsources.KubeconfigManager)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		path := filepath.Join(resolved, entry.Name())
		a.appendKubeconfigFromFile(path, entry.Name(), defaultConfigPath, true, seenFiles)
	}
	return true
}

func (a *App) logKubeconfigPathReadError(path string, err error) {
	if os.IsNotExist(err) {
		a.logger.Warn(fmt.Sprintf("Kubeconfig path not found: %s", path), logsources.KubeconfigManager)
		return
	}
	a.logger.Warn(fmt.Sprintf("Failed to read kubeconfig path %s: %v", path, err), logsources.KubeconfigManager)
}

// appendKubeconfigFromFile validates a kubeconfig file and appends its contexts.
func (a *App) appendKubeconfigFromFile(path string, name string, defaultConfigPath string, applyHeuristics bool, seenFiles map[string]struct{}) {
	cleanedPath := filepath.Clean(path)
	if applyHeuristics && shouldSkipKubeconfigName(name) {
		return
	}

	key := kubeconfigPathKey(cleanedPath)
	if _, exists := seenFiles[key]; exists {
		return
	}
	seenFiles[key] = struct{}{}

	// Parse the file as a kubeconfig to validate it.
	a.logger.Debug(fmt.Sprintf("Validating kubeconfig file: %s", cleanedPath), logsources.KubeconfigManager)
	config, err := clientcmd.LoadFromFile(cleanedPath)
	if err != nil {
		a.logger.Debug(fmt.Sprintf("Skipping %s - not a valid kubeconfig: %v", cleanedPath, err), logsources.KubeconfigManager)
		return
	}

	// Additional validation: ensure it has clusters and contexts.
	if len(config.Clusters) == 0 || len(config.Contexts) == 0 {
		a.logger.Debug(fmt.Sprintf("Skipping %s - no clusters or contexts found", cleanedPath), logsources.KubeconfigManager)
		return
	}

	isDefault := pathsEqual(cleanedPath, defaultConfigPath)
	displayName := name

	a.logger.Info(fmt.Sprintf("Found valid kubeconfig: %s (%d clusters, %d contexts)", cleanedPath, len(config.Clusters), len(config.Contexts)), logsources.KubeconfigManager)

	// Create an entry for each context in the kubeconfig. Validate each context
	// structurally (references an existing cluster + user) via ConfirmUsable —
	// syntax only, no server connectivity — so the Open Cluster UI can flag and
	// disable broken contexts.
	for contextName := range config.Contexts {
		invalid := false
		invalidReason := ""
		if err := clientcmd.ConfirmUsable(*config, contextName); err != nil {
			invalid = true
			invalidReason = err.Error()
		}
		a.availableKubeconfigs = append(a.availableKubeconfigs, KubeconfigInfo{
			Name:             displayName,
			Path:             cleanedPath,
			Context:          contextName,
			IsDefault:        isDefault,
			IsCurrentContext: contextName == config.CurrentContext,
			Invalid:          invalid,
			InvalidReason:    invalidReason,
		})
	}
}

// shouldSkipKubeconfigName filters out obvious non-kubeconfig files in directory scans.
func shouldSkipKubeconfigName(name string) bool {
	if strings.HasPrefix(name, ".") && name != ".kubeconfig" {
		return true
	}

	// Skip common non-kubeconfig files.
	skipPatterns := []string{
		".bak", ".backup", ".old", ".tmp", ".swp", ".swo",
		"~", ".orig", ".rej", ".lock", ".log", ".yaml.bak",
	}

	lower := strings.ToLower(name)
	for _, pattern := range skipPatterns {
		if strings.HasSuffix(lower, pattern) {
			return true
		}
	}

	// Skip files that are clearly not kubeconfigs by name pattern.
	if strings.Contains(lower, "cache") || strings.Contains(lower, "token") || strings.Contains(lower, "credential") {
		return true
	}

	return false
}

// loadKubeconfigSearchPaths reads and normalizes the kubeconfig search paths.
func (a *App) loadKubeconfigSearchPaths() ([]string, error) {
	settings, err := a.loadSettingsFile()
	if err != nil {
		return nil, err
	}
	return normalizeKubeconfigSearchPaths(settings.Kubeconfig.SearchPaths), nil
}

// GetKubeconfigSearchPaths returns the configured kubeconfig search paths.
func (a *App) GetKubeconfigSearchPaths() ([]string, error) {
	paths, err := a.loadKubeconfigSearchPaths()
	if err != nil {
		return nil, err
	}
	return append([]string(nil), paths...), nil
}

// SetKubeconfigSearchPaths persists the search paths and refreshes kubeconfig discovery.
func (a *App) SetKubeconfigSearchPaths(paths []string) error {
	return a.runSelectionMutation("set-kubeconfig-search-paths", func(mutation *selectionMutation) error {
		normalized := normalizeKubeconfigSearchPaths(paths)
		if len(normalized) == 0 {
			return fmt.Errorf("at least one kubeconfig search path is required")
		}

		a.settingsMu.Lock()
		settings, err := a.loadSettingsFile()
		if err == nil {
			settings.Kubeconfig.SearchPaths = normalized
			err = a.saveSettingsFile(settings)
		}
		a.settingsMu.Unlock()
		if err != nil {
			return err
		}

		a.refreshKubeconfigDiscoveryAfterSearchPathChange()
		return nil
	})
}

func (a *App) refreshKubeconfigDiscoveryAfterSearchPathChange() {
	if err := a.discoverKubeconfigs(); err != nil {
		a.logger.Warn(fmt.Sprintf("Failed to refresh kubeconfig discovery: %v", err), logsources.KubeconfigManager)
	}
	if a.kubeconfigWatcher != nil {
		watchPaths := a.resolvedKubeconfigWatchPaths()
		if updateErr := a.kubeconfigWatcher.updateWatchedPaths(watchPaths); updateErr != nil {
			a.logger.Warn(fmt.Sprintf("Failed to update watched paths: %v", updateErr), logsources.KubeconfigWatcher)
		}
	}
	a.pruneSelectionsAgainstDiscoveredKubeconfigs()
}

// OpenKubeconfigSearchPathDialog opens a directory picker for kubeconfig search paths.
func (a *App) OpenKubeconfigSearchPathDialog() (string, error) {
	if !a.runtimeAvailable() {
		return "", fmt.Errorf("application context is not available")
	}

	return a.promptForOpenFile(&application.OpenFileDialogOptions{
		CanChooseDirectories: true,
		CanChooseFiles:       false,
		Title:                "Select kubeconfig directory",
		Directory:            a.defaultKubeconfigSearchDirectory(),
	})
}

// defaultKubeconfigSearchDirectory selects a safe default folder for the directory picker.
func (a *App) defaultKubeconfigSearchDirectory() string {
	searchPaths, err := a.loadKubeconfigSearchPaths()
	if err == nil {
		if directory := firstExistingKubeconfigDirectory(searchPaths); directory != "" {
			return directory
		}
	}

	home := homedir.HomeDir()
	if home != "" {
		return home
	}

	return ""
}

func firstExistingKubeconfigDirectory(searchPaths []string) string {
	for _, entry := range searchPaths {
		resolved := resolveKubeconfigSearchPath(entry)
		if resolved == "" {
			continue
		}
		info, err := os.Stat(resolved)
		if err != nil {
			continue
		}
		if info.IsDir() {
			return resolved
		}
		parent := filepath.Dir(resolved)
		if parent == "" {
			continue
		}
		parentInfo, err := os.Stat(parent)
		if err == nil && parentInfo.IsDir() {
			return parent
		}
	}
	return ""
}

// normalizeKubeconfigSearchPaths trims and deduplicates kubeconfig path entries.
func normalizeKubeconfigSearchPaths(paths []string) []string {
	normalized := make([]string, 0, len(paths))
	seen := make(map[string]struct{}, len(paths))

	for _, path := range paths {
		trimmed := strings.TrimSpace(path)
		if trimmed == "" {
			continue
		}
		resolved := resolveKubeconfigSearchPath(trimmed)
		key := kubeconfigPathKey(resolved)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		normalized = append(normalized, trimmed)
	}

	return normalized
}

// resolveKubeconfigSearchPath expands home directory references for discovery.
func resolveKubeconfigSearchPath(path string) string {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return ""
	}

	if strings.HasPrefix(trimmed, "~") {
		home := homedir.HomeDir()
		if home != "" {
			if trimmed == "~" {
				trimmed = home
			} else if strings.HasPrefix(trimmed, "~/") || strings.HasPrefix(trimmed, "~\\") {
				trimmed = filepath.Join(home, trimmed[2:])
			}
		}
	}

	return filepath.Clean(trimmed)
}

// kubeconfigPathKey normalizes path keys for comparisons.
func kubeconfigPathKey(path string) string {
	if runtime.GOOS == "windows" {
		return strings.ToLower(path)
	}
	return path
}

// pathsEqual compares paths with OS-specific case rules.
func pathsEqual(left, right string) bool {
	if runtime.GOOS == "windows" {
		return strings.EqualFold(left, right)
	}
	return left == right
}

// GetKubeconfigs returns the available kubeconfigs and the current discovery state.
func (a *App) GetKubeconfigs() (KubeconfigDiscoveryResult, error) {
	a.kubeconfigsMu.RLock()
	if len(a.availableKubeconfigs) > 0 {
		result := KubeconfigDiscoveryResult{
			Kubeconfigs: append([]KubeconfigInfo(nil), a.availableKubeconfigs...),
			State:       KubeconfigDiscoveryStateAvailable,
			SearchPaths: append([]string(nil), a.kubeconfigSearchPaths...),
		}
		a.kubeconfigsMu.RUnlock()
		return result, nil
	}
	a.kubeconfigsMu.RUnlock()

	if err := a.discoverKubeconfigs(); err != nil {
		return KubeconfigDiscoveryResult{}, err
	}

	a.kubeconfigsMu.RLock()
	defer a.kubeconfigsMu.RUnlock()
	return KubeconfigDiscoveryResult{
		Kubeconfigs: append([]KubeconfigInfo(nil), a.availableKubeconfigs...),
		State:       a.kubeconfigDiscoveryState,
		SearchPaths: append([]string(nil), a.kubeconfigSearchPaths...),
	}, nil
}

// GetSelectedKubeconfigs returns the active kubeconfig selections for multi-cluster support.
func (a *App) GetSelectedKubeconfigs() []string {
	a.kubeconfigsMu.RLock()
	defer a.kubeconfigsMu.RUnlock()
	if len(a.selectedKubeconfigs) > 0 {
		return append([]string(nil), a.selectedKubeconfigs...)
	}
	return []string{}
}

// setSelectedKubeconfigsLocked updates the selection snapshot. The caller must
// hold kubeconfigsMu so the value and workspace revision commit together.
func (a *App) setSelectedKubeconfigsLocked(selections []string) {
	a.selectedKubeconfigs = append([]string(nil), selections...)
	a.markClusterWorkspaceChanged()
}

// SetKubeconfig switches to a different kubeconfig file and context
// The parameter should be in the format "path:context"
func (a *App) SetKubeconfig(selection string) error {
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

// selectionChangeIntent captures the parsed/validated selection intent before runtime work begins.
type selectionChangeIntent struct {
	generation              uint64
	normalizedSelections    []kubeconfigSelection
	normalizedSelectionText []string
	selectionChanged        bool
	clearSelection          bool
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
// IMPORTANT: This function is called at runtime when the user changes their cluster selection,
// which is different from app startup where initKubernetesClient() handles the initial setup.
// Both code paths must perform the same initialization steps to ensure consistent behavior.
func (a *App) SetSelectedKubeconfigs(selections []string) error {
	return a.runSelectionMutation("set-selected-kubeconfigs", func(mutation *selectionMutation) error {
		return a.setSelectedKubeconfigs(mutation, selections)
	})
}

func (a *App) setSelectedKubeconfigs(mutation *selectionMutation, selections []string) error {
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
func (a *App) CloseCluster(selectionOrClusterID string) error {
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

	a.cleanupClusterRuntimeOperations(targetClusterID, clusterDisconnectedReason)
	if !found {
		return nil
	}
	return a.SetSelectedKubeconfigs(remainingSelections)
}

func (a *App) clusterIDForSelection(selection string) string {
	parsed, err := parseKubeconfigSelection(selection)
	if err != nil {
		return ""
	}
	if clients := a.clusterClientsForSelection(parsed); clients != nil && clients.meta.ID != "" {
		return clients.meta.ID
	}
	return a.clusterMetaForSelection(parsed).ID
}

// buildSelectionChangeIntent parses and validates a requested selection set.
func (a *App) buildSelectionChangeIntent(selections []string, generation uint64) (selectionChangeIntent, error) {
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

func (a *App) normalizeSelectionSet(selections []string) ([]kubeconfigSelection, []string, error) {
	normalized := make([]kubeconfigSelection, 0, len(selections))
	normalizedStrings := make([]string, 0, len(selections))
	seenContexts := make(map[string]struct{}, len(selections))
	for _, selection := range selections {
		parsed, err := a.normalizeKubeconfigSelection(selection)
		if err != nil {
			return nil, nil, err
		}
		if err := a.validateKubeconfigSelection(parsed); err != nil {
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

func selectionSetsEqual(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

// commitSelectionChangeIntent applies validated selection state in-memory and to settings.
func (a *App) commitSelectionChangeIntent(intent selectionChangeIntent) {
	a.kubeconfigsMu.Lock()
	a.setSelectedKubeconfigsLocked(intent.normalizedSelectionText)
	a.kubeconfigsMu.Unlock()

	a.settingsMu.Lock()
	if a.appSettings == nil {
		a.appSettings = getDefaultAppSettings()
	}
	a.appSettings.SelectedKubeconfigs = append([]string(nil), intent.normalizedSelectionText...)
	if err := a.saveAppSettings(); err != nil {
		a.logger.Warn(fmt.Sprintf("Failed to save kubeconfig selection: %v", err), logsources.KubeconfigManager)
	}
	a.settingsMu.Unlock()
}

// executeSelectionChangeWork performs client and refresh work for an already-committed intent.
func (a *App) executeSelectionChangeWork(
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

func (a *App) reconcileRefreshSubsystemSelections(selections []kubeconfigSelection) error {
	if a.refreshHTTPServer == nil || a.refreshAggregates.Load() == nil || a.currentRefreshRuntimeContext() == nil {
		return a.setupRefreshSubsystem()
	}
	return a.updateRefreshSubsystemSelections(selections)
}

// clearKubeconfigSelection clears the active selection and resets client state.
func (a *App) clearKubeconfigSelection() error {
	a.logger.Info("Clearing kubeconfig selection", logsources.KubeconfigManager)
	a.kubeconfigsMu.Lock()
	a.setSelectedKubeconfigsLocked(nil)
	a.kubeconfigsMu.Unlock()
	var authManagers []interface{ Shutdown() }
	clusterIDs := make(map[string]struct{})
	a.clusterClientsMu.Lock()
	for id, clients := range a.clusterClients {
		clusterIDs[id] = struct{}{}
		if clients != nil && clients.authManager != nil {
			authManagers = append(authManagers, clients.authManager)
		}
	}
	a.clearClusterClientsLocked()
	a.clusterClientsMu.Unlock()
	for _, mgr := range authManagers {
		mgr.Shutdown()
	}
	for clusterID := range clusterIDs {
		a.cleanupClusterRuntimeOperations(clusterID, clusterDisconnectedReason)
		a.removeClusterWorkspaceState(clusterID)
	}
	a.teardownRefreshSubsystem()

	a.settingsMu.Lock()
	if a.appSettings == nil {
		a.appSettings = getDefaultAppSettings()
	}
	a.appSettings.SelectedKubeconfigs = nil
	if err := a.saveAppSettings(); err != nil {
		a.logger.Warn(fmt.Sprintf("Failed to save kubeconfig selection: %v", err), logsources.KubeconfigManager)
	}
	a.settingsMu.Unlock()

	return nil
}

// startKubeconfigWatcher creates and starts the kubeconfig directory watcher.
func (a *App) startKubeconfigWatcher() error {
	if a.kubeconfigWatcher != nil {
		return nil
	}

	w, err := newKubeconfigWatcher(a, a.handleKubeconfigChange)
	if err != nil {
		return err
	}
	a.kubeconfigWatcher = w

	watchPaths := a.resolvedKubeconfigWatchPaths()
	if err := w.updateWatchedPaths(watchPaths); err != nil {
		a.logger.Warn(fmt.Sprintf("Failed to set watched paths: %v", err), logsources.KubeconfigWatcher)
	}

	a.logger.Info(fmt.Sprintf("Kubeconfig watcher started, watching %d path(s)", len(watchPaths)), logsources.KubeconfigWatcher)
	return nil
}

// stopKubeconfigWatcher stops the kubeconfig directory watcher if running.
func (a *App) stopKubeconfigWatcher() {
	if a.kubeconfigWatcher == nil {
		return
	}
	a.kubeconfigWatcher.stop()
	a.kubeconfigWatcher = nil
}

// resolvedKubeconfigWatchPaths returns watchedPath entries for configured search paths.
func (a *App) resolvedKubeconfigWatchPaths() []watchedPath {
	searchPaths, err := a.loadKubeconfigSearchPaths()
	if err != nil {
		return nil
	}

	dirMap := make(map[string]*kubeconfigWatchDirectory)
	for _, entry := range searchPaths {
		resolved := resolveKubeconfigSearchPath(entry)
		if resolved == "" {
			continue
		}
		mergeKubeconfigWatchDirectory(dirMap, resolved)
	}

	return kubeconfigWatchedPaths(dirMap)
}

func mergeKubeconfigWatchDirectory(dirMap map[string]*kubeconfigWatchDirectory, resolved string) {
	info, statErr := os.Stat(resolved)
	if statErr == nil && info.IsDir() {
		key := kubeconfigPathKey(resolved)
		if existing := dirMap[key]; existing != nil {
			existing.unfiltered = true
			existing.filterFiles = nil
			return
		}
		dirMap[key] = &kubeconfigWatchDirectory{dir: resolved, unfiltered: true}
		return
	}

	parentDir := filepath.Dir(resolved)
	parentInfo, parentErr := os.Stat(parentDir)
	if parentErr != nil || !parentInfo.IsDir() {
		return
	}
	key := kubeconfigPathKey(parentDir)
	entry := dirMap[key]
	if entry == nil {
		entry = &kubeconfigWatchDirectory{dir: parentDir, filterFiles: make(map[string]struct{})}
		dirMap[key] = entry
	}
	if !entry.unfiltered {
		entry.filterFiles[filepath.Base(resolved)] = struct{}{}
	}
}

func kubeconfigWatchedPaths(dirMap map[string]*kubeconfigWatchDirectory) []watchedPath {
	result := make([]watchedPath, 0, len(dirMap))
	for _, entry := range dirMap {
		wp := watchedPath{dir: entry.dir}
		if !entry.unfiltered && entry.filterFiles != nil {
			wp.filterFiles = entry.filterFiles
		}
		result = append(result, wp)
	}
	return result
}

// handleKubeconfigChange is called (debounced) when file changes are detected.
func (a *App) handleKubeconfigChange(changedPaths []string) {
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
func (a *App) handleKubeconfigChangeLocked(changedPaths []string, generation uint64) {
	a.logger.Info(
		fmt.Sprintf("Kubeconfig file change detected (%d file(s)), refreshing... (generation=%d)", len(changedPaths), generation),
		"KubeconfigWatcher",
	)
	affectedClusterIDs := a.affectedKubeconfigClusters(changedKubeconfigPathSet(changedPaths))
	if err := a.discoverKubeconfigs(); err != nil {
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
	a.emitEvent("kubeconfig:available-changed")
}

type kubeconfigSelectionKey struct {
	path    string
	context string
}

type kubeconfigFileInspection struct {
	missing  bool
	loadErr  error
	contexts map[string]struct{}
}

type kubeconfigFileInspector struct {
	cache map[string]kubeconfigFileInspection
}

type changedKubeconfigAction uint8

const (
	changedKubeconfigKeep changedKubeconfigAction = iota
	changedKubeconfigRebuild
	changedKubeconfigDeselect
)

func changedKubeconfigPathSet(paths []string) map[string]struct{} {
	changed := make(map[string]struct{}, len(paths))
	for _, path := range paths {
		changed[kubeconfigPathKey(filepath.Clean(path))] = struct{}{}
	}
	return changed
}

func (a *App) affectedKubeconfigClusters(changedPaths map[string]struct{}) []string {
	a.clusterClientsMu.Lock()
	defer a.clusterClientsMu.Unlock()
	var affected []string
	for id, clients := range a.clusterClients {
		if clients == nil {
			continue
		}
		pathKey := kubeconfigPathKey(filepath.Clean(clients.kubeconfigPath))
		if _, changed := changedPaths[pathKey]; changed {
			affected = append(affected, id)
		}
	}
	return affected
}

func (a *App) logKubeconfigDiscoveryComplete() {
	a.kubeconfigsMu.RLock()
	count := len(a.availableKubeconfigs)
	a.kubeconfigsMu.RUnlock()
	a.logger.Info(fmt.Sprintf("Re-discovery complete, found %d kubeconfig(s)", count), logsources.KubeconfigWatcher)
}

func (a *App) discoverableKubeconfigSelections() map[kubeconfigSelectionKey]struct{} {
	a.kubeconfigsMu.RLock()
	defer a.kubeconfigsMu.RUnlock()
	discoverable := make(map[kubeconfigSelectionKey]struct{}, len(a.availableKubeconfigs))
	for _, kubeconfig := range a.availableKubeconfigs {
		discoverable[newKubeconfigSelectionKey(kubeconfig.Path, kubeconfig.Context)] = struct{}{}
	}
	return discoverable
}

func newKubeconfigSelectionKey(path, contextName string) kubeconfigSelectionKey {
	return kubeconfigSelectionKey{path: kubeconfigPathKey(filepath.Clean(path)), context: contextName}
}

func (a *App) classifyChangedKubeconfigClusters(clusterIDs []string) ([]string, []string) {
	a.logger.Info(fmt.Sprintf("Processing %d affected cluster(s)", len(clusterIDs)), logsources.KubeconfigWatcher)
	discoverable := a.discoverableKubeconfigSelections()
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

func (a *App) classifyChangedKubeconfigCluster(
	clusterID string,
	discoverable map[kubeconfigSelectionKey]struct{},
	inspector *kubeconfigFileInspector,
) changedKubeconfigAction {
	clients := a.clusterClientsForID(clusterID)
	if clients == nil {
		return changedKubeconfigKeep
	}
	if _, ok := discoverable[newKubeconfigSelectionKey(clients.kubeconfigPath, clients.kubeconfigContext)]; ok {
		return changedKubeconfigRebuild
	}
	return a.classifyInspectedKubeconfig(clients, inspector.inspect(clients.kubeconfigPath))
}

func (a *App) classifyInspectedKubeconfig(clients *clusterClients, inspection kubeconfigFileInspection) changedKubeconfigAction {
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

func kubeconfigContextExists(inspection kubeconfigFileInspection, contextName string) bool {
	_, exists := inspection.contexts[contextName]
	return exists
}

func (i *kubeconfigFileInspector) inspect(path string) kubeconfigFileInspection {
	cleanPath := filepath.Clean(path)
	cacheKey := kubeconfigPathKey(cleanPath)
	if cached, ok := i.cache[cacheKey]; ok {
		return cached
	}
	inspection := inspectKubeconfigFile(cleanPath)
	i.cache[cacheKey] = inspection
	return inspection
}

func inspectKubeconfigFile(path string) kubeconfigFileInspection {
	info, err := os.Stat(path)
	if os.IsNotExist(err) {
		return kubeconfigFileInspection{missing: true}
	}
	if err != nil {
		return kubeconfigFileInspection{loadErr: err}
	}
	if info.IsDir() {
		return kubeconfigFileInspection{loadErr: fmt.Errorf("path is a directory")}
	}
	config, err := clientcmd.LoadFromFile(path)
	if err != nil {
		return kubeconfigFileInspection{loadErr: err}
	}
	contexts := make(map[string]struct{}, len(config.Contexts))
	for contextName := range config.Contexts {
		contexts[contextName] = struct{}{}
	}
	return kubeconfigFileInspection{contexts: contexts}
}

func (a *App) reconnectChangedKubeconfigClusters(clusterIDs []string) {
	for _, clusterID := range clusterIDs {
		clients := a.clusterClientsForID(clusterID)
		if clients == nil {
			continue
		}
		a.logger.Info(fmt.Sprintf("Reconnecting cluster %s after kubeconfig change", clients.meta.Name), logsources.KubeconfigWatcher)
		a.teardownClusterSubsystem(clusterID)
		a.rebuildClusterSubsystem(clusterID)
	}
}

// deselectClusters removes the specified cluster IDs from the active selection.
// Caller must run within a coordinated selection mutation boundary.
func (a *App) deselectClusters(clusterIDs []string) {
	if len(clusterIDs) == 0 {
		return
	}

	type pathContextKey struct {
		path    string
		context string
	}
	removalKeys := make(map[pathContextKey]struct{}, len(clusterIDs))
	a.clusterClientsMu.Lock()
	for _, id := range clusterIDs {
		if clients, ok := a.clusterClients[id]; ok && clients != nil {
			removalKeys[pathContextKey{
				path:    kubeconfigPathKey(filepath.Clean(clients.kubeconfigPath)),
				context: clients.kubeconfigContext,
			}] = struct{}{}
		}
	}
	a.clusterClientsMu.Unlock()

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
func (a *App) pruneSelectionsAgainstDiscoveredKubeconfigs() {
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

func (a *App) classifyDiscoveredSelections(currentSelections []string) discoveredSelectionPrune {
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
		if a.validateKubeconfigSelection(parsed) == nil {
			result.remainingSelections = append(result.remainingSelections, parsed.String())
			result.remainingParsed = append(result.remainingParsed, parsed)
			continue
		}
		appendUniqueClusterID(&result.removedClusterIDs, removedSeen, a.clusterIDForRemovedSelection(parsed))
	}
	return result
}

func (a *App) clusterIDForRemovedSelection(selection kubeconfigSelection) string {
	if clients := a.clusterClientsForSelection(selection); clients != nil && clients.meta.ID != "" {
		return clients.meta.ID
	}
	return a.clusterMetaForSelection(selection).ID
}

func appendUniqueClusterID(clusterIDs *[]string, seen map[string]struct{}, clusterID string) {
	if clusterID == "" {
		return
	}
	if _, exists := seen[clusterID]; exists {
		return
	}
	seen[clusterID] = struct{}{}
	*clusterIDs = append(*clusterIDs, clusterID)
}

// applySelectionPrune commits an already-computed selection prune and tears down removed cluster state.
// Caller must already hold the coordinated selection mutation boundary.
func (a *App) applySelectionPrune(
	remainingSelections []string,
	remainingParsed []kubeconfigSelection,
	removedClusterIDs []string,
	logComponent string,
) {
	if len(remainingParsed) > 0 {
		if err := a.updateRefreshSubsystemSelections(remainingParsed); err != nil {
			a.logger.Warn(fmt.Sprintf("Failed to reconcile refresh subsystems after deselect, aborting: %v", err), logComponent)
			return
		}
	} else {
		a.teardownRefreshSubsystem()
	}

	a.kubeconfigsMu.Lock()
	a.setSelectedKubeconfigsLocked(remainingSelections)
	a.kubeconfigsMu.Unlock()

	var authManagers []interface{ Shutdown() }
	a.clusterClientsMu.Lock()
	for _, id := range removedClusterIDs {
		if clients, ok := a.removeClusterClientLocked(id); ok {
			if clients != nil && clients.authManager != nil {
				authManagers = append(authManagers, clients.authManager)
			}
		}
	}
	a.clusterClientsMu.Unlock()
	for _, mgr := range authManagers {
		mgr.Shutdown()
	}
	for _, id := range removedClusterIDs {
		a.cleanupClusterRuntimeOperations(id, clusterDisconnectedReason)
		a.removeClusterWorkspaceState(id)
	}

	a.settingsMu.Lock()
	if a.appSettings == nil {
		a.appSettings = getDefaultAppSettings()
	}
	a.appSettings.SelectedKubeconfigs = append([]string(nil), remainingSelections...)
	if err := a.saveAppSettings(); err != nil {
		a.logger.Warn(fmt.Sprintf("Failed to save updated selection: %v", err), logComponent)
	}
	a.settingsMu.Unlock()
}

package backend

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
)

// discoverKubeconfigs scans configured kubeconfig search paths for kubeconfig files.
func (a *App) discoverKubeconfigs() error {
	a.kubeconfigsMu.Lock()
	defer a.kubeconfigsMu.Unlock()
	return a.discoverKubeconfigsLocked()
}

func (a *App) discoverKubeconfigsLocked() error {
	a.logger.Debug("Starting kubeconfig discovery", "KubeconfigManager")
	a.availableKubeconfigs = []KubeconfigInfo{}

	searchPaths, err := a.loadKubeconfigSearchPaths()
	if err != nil {
		a.logger.Error(fmt.Sprintf("Failed to load kubeconfig search paths: %v", err), "KubeconfigManager")
		return err
	}
	if len(searchPaths) == 0 {
		a.logger.Warn("No kubeconfig search paths configured", "KubeconfigManager")
		return nil
	}

	defaultConfigPath := resolveKubeconfigSearchPath(filepath.Join("~", ".kube", "config"))
	foundRoot := false
	seenFiles := make(map[string]struct{})

	for _, entry := range searchPaths {
		resolved := resolveKubeconfigSearchPath(entry)
		if resolved == "" {
			continue
		}
		info, err := os.Stat(resolved)
		if err != nil {
			if os.IsNotExist(err) {
				a.logger.Warn(fmt.Sprintf("Kubeconfig path not found: %s", resolved), "KubeconfigManager")
			} else {
				a.logger.Warn(fmt.Sprintf("Failed to read kubeconfig path %s: %v", resolved, err), "KubeconfigManager")
			}
			continue
		}
		foundRoot = true

		if info.IsDir() {
			a.logger.Debug(fmt.Sprintf("Scanning directory: %s", resolved), "KubeconfigManager")
			entries, err := os.ReadDir(resolved)
			if err != nil {
				a.logger.Warn(fmt.Sprintf("Failed to read kubeconfig directory %s: %v", resolved, err), "KubeconfigManager")
				continue
			}
			a.logger.Debug(fmt.Sprintf("Found %d items in %s", len(entries), resolved), "KubeconfigManager")
			for _, d := range entries {
				// Skip directories - we only want files directly in the search directory.
				if d.IsDir() {
					continue
				}
				path := filepath.Join(resolved, d.Name())
				a.appendKubeconfigFromFile(path, d.Name(), defaultConfigPath, true, seenFiles)
			}
			continue
		}

		a.appendKubeconfigFromFile(resolved, filepath.Base(resolved), defaultConfigPath, false, seenFiles)
	}

	if !foundRoot {
		return fmt.Errorf("no kubeconfig search paths exist")
	}

	return nil
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
	a.logger.Debug(fmt.Sprintf("Validating kubeconfig file: %s", cleanedPath), "KubeconfigManager")
	config, err := clientcmd.LoadFromFile(cleanedPath)
	if err != nil {
		a.logger.Debug(fmt.Sprintf("Skipping %s - not a valid kubeconfig: %v", cleanedPath, err), "KubeconfigManager")
		return
	}

	// Additional validation: ensure it has clusters and contexts.
	if len(config.Clusters) == 0 || len(config.Contexts) == 0 {
		a.logger.Debug(fmt.Sprintf("Skipping %s - no clusters or contexts found", cleanedPath), "KubeconfigManager")
		return
	}

	isDefault := pathsEqual(cleanedPath, defaultConfigPath)
	displayName := name

	a.logger.Info(fmt.Sprintf("Found valid kubeconfig: %s (%d clusters, %d contexts)", cleanedPath, len(config.Clusters), len(config.Contexts)), "KubeconfigManager")

	// Create an entry for each context in the kubeconfig.
	for contextName := range config.Contexts {
		a.availableKubeconfigs = append(a.availableKubeconfigs, KubeconfigInfo{
			Name:             displayName,
			Path:             cleanedPath,
			Context:          contextName,
			IsDefault:        isDefault,
			IsCurrentContext: contextName == config.CurrentContext,
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
	normalized := normalizeKubeconfigSearchPaths(paths)

	settings, err := a.loadSettingsFile()
	if err != nil {
		return err
	}

	settings.Kubeconfig.SearchPaths = normalized
	if err := a.saveSettingsFile(settings); err != nil {
		return err
	}

	if err := a.discoverKubeconfigs(); err != nil {
		a.logger.Warn(fmt.Sprintf("Failed to refresh kubeconfig discovery: %v", err), "KubeconfigManager")
	}
	if a.kubeconfigWatcher != nil {
		watchPaths := a.resolvedKubeconfigWatchPaths()
		if updateErr := a.kubeconfigWatcher.updateWatchedPaths(watchPaths); updateErr != nil {
			a.logger.Warn(fmt.Sprintf("Failed to update watched paths: %v", updateErr), "KubeconfigWatcher")
		}
	}

	return nil
}

// OpenKubeconfigSearchPathDialog opens a directory picker for kubeconfig search paths.
func (a *App) OpenKubeconfigSearchPathDialog() (string, error) {
	if a.Ctx == nil {
		return "", fmt.Errorf("application context is not available")
	}

	return wailsruntime.OpenDirectoryDialog(a.Ctx, wailsruntime.OpenDialogOptions{
		Title:            "Select kubeconfig directory",
		DefaultDirectory: a.defaultKubeconfigSearchDirectory(),
	})
}

// defaultKubeconfigSearchDirectory selects a safe default folder for the directory picker.
func (a *App) defaultKubeconfigSearchDirectory() string {
	searchPaths, err := a.loadKubeconfigSearchPaths()
	if err == nil {
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
	}

	home := homedir.HomeDir()
	if home != "" {
		return home
	}

	return ""
}

// normalizeKubeconfigSearchPaths trims and deduplicates kubeconfig path entries.
func normalizeKubeconfigSearchPaths(paths []string) []string {
	normalized := make([]string, 0, len(paths))
	seen := make(map[string]struct{}, len(paths))
	// Always retain the default kubeconfig location in the list.
	defaultEntry := defaultKubeconfigSearchPaths()[0]
	defaultResolved := resolveKubeconfigSearchPath(defaultEntry)
	defaultKey := kubeconfigPathKey(defaultResolved)

	for _, path := range paths {
		trimmed := strings.TrimSpace(path)
		if trimmed == "" {
			continue
		}
		resolved := resolveKubeconfigSearchPath(trimmed)
		key := kubeconfigPathKey(resolved)
		if key == defaultKey {
			if _, exists := seen[defaultKey]; exists {
				continue
			}
			seen[defaultKey] = struct{}{}
			normalized = append(normalized, defaultEntry)
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		normalized = append(normalized, trimmed)
	}

	if _, exists := seen[defaultKey]; !exists {
		normalized = append(normalized, defaultEntry)
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
func pathsEqual(left string, right string) bool {
	if runtime.GOOS == "windows" {
		return strings.EqualFold(left, right)
	}
	return left == right
}

// GetKubeconfigs returns the list of available kubeconfig files
func (a *App) GetKubeconfigs() ([]KubeconfigInfo, error) {
	a.kubeconfigsMu.RLock()
	if len(a.availableKubeconfigs) > 0 {
		result := append([]KubeconfigInfo(nil), a.availableKubeconfigs...)
		a.kubeconfigsMu.RUnlock()
		return result, nil
	}
	a.kubeconfigsMu.RUnlock()

	if err := a.discoverKubeconfigs(); err != nil {
		return nil, err
	}

	a.kubeconfigsMu.RLock()
	defer a.kubeconfigsMu.RUnlock()
	return append([]KubeconfigInfo(nil), a.availableKubeconfigs...), nil
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

// SetKubeconfig switches to a different kubeconfig file and context
// The parameter should be in the format "path:context"
func (a *App) SetKubeconfig(selection string) error {
	a.logger.Info(fmt.Sprintf("Switching kubeconfig to: %s", selection), "KubeconfigManager")

	if strings.TrimSpace(selection) == "" {
		return a.SetSelectedKubeconfigs(nil)
	}

	// Delegate to the multi-cluster selection flow to avoid implicit base routing.
	if err := a.SetSelectedKubeconfigs([]string{selection}); err != nil {
		return err
	}

	parsed, err := parseKubeconfigSelection(selection)
	if err == nil {
		a.logger.Info(fmt.Sprintf("Successfully switched to kubeconfig %s with context %s", parsed.Path, parsed.Context), "KubeconfigManager")
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
	return a.runSelectionMutation("set-selected-kubeconfigs", func(mutation selectionMutation) error {
		intent, err := a.buildSelectionChangeIntent(selections, mutation.generation)
		if err != nil {
			return err
		}

		if intent.clearSelection {
			return a.clearKubeconfigSelection()
		}

		a.commitSelectionChangeIntent(intent)
		return a.executeSelectionChangeWork(intent)
	})
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

	normalized := make([]kubeconfigSelection, 0, len(selections))
	normalizedStrings := make([]string, 0, len(selections))
	seenContexts := make(map[string]struct{}, len(selections))

	for _, selection := range selections {
		parsed, err := a.normalizeKubeconfigSelection(selection)
		if err != nil {
			return selectionChangeIntent{}, err
		}
		if err := a.validateKubeconfigSelection(parsed); err != nil {
			return selectionChangeIntent{}, err
		}

		selectionKey := parsed.String()
		if selectionKey != "" {
			if _, exists := seenContexts[selectionKey]; exists {
				return selectionChangeIntent{}, fmt.Errorf("duplicate selection: %s", selectionKey)
			}
			seenContexts[selectionKey] = struct{}{}
		}

		normalized = append(normalized, parsed)
		normalizedStrings = append(normalizedStrings, parsed.String())
	}

	selectionChanged := len(previousSelections) != len(normalizedStrings)
	if !selectionChanged {
		for i, selection := range previousSelections {
			if selection != normalizedStrings[i] {
				selectionChanged = true
				break
			}
		}
	}

	intent.normalizedSelections = normalized
	intent.normalizedSelectionText = normalizedStrings
	intent.selectionChanged = selectionChanged
	return intent, nil
}

// commitSelectionChangeIntent applies validated selection state in-memory and to settings.
func (a *App) commitSelectionChangeIntent(intent selectionChangeIntent) {
	a.kubeconfigsMu.Lock()
	a.selectedKubeconfigs = append([]string(nil), intent.normalizedSelectionText...)
	a.kubeconfigsMu.Unlock()

	a.settingsMu.Lock()
	if a.appSettings == nil {
		a.appSettings = getDefaultAppSettings()
	}
	a.appSettings.SelectedKubeconfigs = append([]string(nil), intent.normalizedSelectionText...)
	if err := a.saveAppSettings(); err != nil {
		a.logger.Warn(fmt.Sprintf("Failed to save kubeconfig selection: %v", err), "KubeconfigManager")
	}
	a.settingsMu.Unlock()
}

// executeSelectionChangeWork performs client and refresh work for an already-committed intent.
func (a *App) executeSelectionChangeWork(intent selectionChangeIntent) error {
	if !a.isSelectionGenerationCurrent(intent.generation) {
		if a.logger != nil {
			a.logger.Debug(
				fmt.Sprintf("Skipping superseded selection work (generation=%d)", intent.generation),
				"KubeconfigManager",
			)
		}
		return nil
	}

	if err := a.syncClusterClientPool(intent.normalizedSelections); err != nil {
		return err
	}

	if !intent.selectionChanged {
		return nil
	}

	if a.refreshHTTPServer == nil || a.refreshAggregates == nil || a.refreshCtx == nil {
		if err := a.setupRefreshSubsystem(); err != nil {
			return err
		}
	} else {
		if err := a.updateRefreshSubsystemSelections(intent.normalizedSelections); err != nil {
			return err
		}
	}

	a.startObjectCatalog()
	return nil
}

// clearKubeconfigSelection clears the active selection and resets client state.
func (a *App) clearKubeconfigSelection() error {
	a.logger.Info("Clearing kubeconfig selection", "KubeconfigManager")
	a.kubeconfigsMu.Lock()
	a.selectedKubeconfigs = nil
	a.kubeconfigsMu.Unlock()
	var authManagers []interface{ Shutdown() }
	a.clusterClientsMu.Lock()
	for _, clients := range a.clusterClients {
		if clients != nil && clients.authManager != nil {
			authManagers = append(authManagers, clients.authManager)
		}
	}
	a.clusterClients = make(map[string]*clusterClients)
	a.clusterClientsMu.Unlock()
	for _, mgr := range authManagers {
		mgr.Shutdown()
	}
	clearGVRCache()
	a.teardownRefreshSubsystem()

	a.settingsMu.Lock()
	if a.appSettings == nil {
		a.appSettings = getDefaultAppSettings()
	}
	a.appSettings.SelectedKubeconfigs = nil
	if err := a.saveAppSettings(); err != nil {
		a.logger.Warn(fmt.Sprintf("Failed to save kubeconfig selection: %v", err), "KubeconfigManager")
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
		a.logger.Warn(fmt.Sprintf("Failed to set watched paths: %v", err), "KubeconfigWatcher")
	}

	a.logger.Info(fmt.Sprintf("Kubeconfig watcher started, watching %d path(s)", len(watchPaths)), "KubeconfigWatcher")
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

	type dirEntry struct {
		dir         string
		unfiltered  bool
		filterFiles map[string]struct{}
	}

	dirMap := make(map[string]*dirEntry)
	for _, entry := range searchPaths {
		resolved := resolveKubeconfigSearchPath(entry)
		if resolved == "" {
			continue
		}
		info, statErr := os.Stat(resolved)
		if statErr == nil && info.IsDir() {
			key := kubeconfigPathKey(resolved)
			if existing, ok := dirMap[key]; ok {
				existing.unfiltered = true
			} else {
				dirMap[key] = &dirEntry{dir: resolved, unfiltered: true}
			}
			continue
		}

		parentDir := filepath.Dir(resolved)
		parentInfo, parentErr := os.Stat(parentDir)
		if parentErr != nil || !parentInfo.IsDir() {
			continue
		}
		key := kubeconfigPathKey(parentDir)
		filename := filepath.Base(resolved)
		if existing, ok := dirMap[key]; ok {
			if !existing.unfiltered {
				if existing.filterFiles == nil {
					existing.filterFiles = make(map[string]struct{})
				}
				existing.filterFiles[filename] = struct{}{}
			}
			continue
		}
		dirMap[key] = &dirEntry{
			dir:         parentDir,
			filterFiles: map[string]struct{}{filename: {}},
		}
	}

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

	if err := a.runSelectionMutation("kubeconfig-watcher-change", func(mutation selectionMutation) error {
		a.handleKubeconfigChangeLocked(changedPaths, mutation.generation)
		return nil
	}); err != nil && a.logger != nil {
		a.logger.Warn(fmt.Sprintf("Failed to process kubeconfig file changes: %v", err), "KubeconfigWatcher")
	}
}

// handleKubeconfigChangeLocked processes file watcher mutations under the selection mutation boundary.
func (a *App) handleKubeconfigChangeLocked(changedPaths []string, generation uint64) {
	a.logger.Info(
		fmt.Sprintf("Kubeconfig file change detected (%d file(s)), refreshing... (generation=%d)", len(changedPaths), generation),
		"KubeconfigWatcher",
	)

	changedSet := make(map[string]struct{}, len(changedPaths))
	for _, p := range changedPaths {
		changedSet[kubeconfigPathKey(filepath.Clean(p))] = struct{}{}
	}

	var affectedClusterIDs []string
	a.clusterClientsMu.Lock()
	for id, clients := range a.clusterClients {
		if clients == nil {
			continue
		}
		clientPathKey := kubeconfigPathKey(filepath.Clean(clients.kubeconfigPath))
		if _, changed := changedSet[clientPathKey]; changed {
			affectedClusterIDs = append(affectedClusterIDs, id)
		}
	}
	a.clusterClientsMu.Unlock()

	if err := a.discoverKubeconfigs(); err != nil {
		a.logger.Warn(fmt.Sprintf("Failed to re-discover kubeconfigs; skipping reconnect/deselect until next event: %v", err), "KubeconfigWatcher")
		return
	}

	a.kubeconfigsMu.RLock()
	count := len(a.availableKubeconfigs)
	a.kubeconfigsMu.RUnlock()
	a.logger.Info(fmt.Sprintf("Re-discovery complete, found %d kubeconfig(s)", count), "KubeconfigWatcher")

	if len(affectedClusterIDs) > 0 {
		a.logger.Info(fmt.Sprintf("Processing %d affected cluster(s)", len(affectedClusterIDs)), "KubeconfigWatcher")

		type pathContextKey struct {
			path    string
			context string
		}

		a.kubeconfigsMu.RLock()
		discoverable := make(map[pathContextKey]struct{}, len(a.availableKubeconfigs))
		for _, kc := range a.availableKubeconfigs {
			discoverable[pathContextKey{
				path:    kubeconfigPathKey(filepath.Clean(kc.Path)),
				context: kc.Context,
			}] = struct{}{}
		}
		a.kubeconfigsMu.RUnlock()

		type fileInspection struct {
			missing  bool
			loadErr  error
			contexts map[string]struct{}
		}
		fileInspections := make(map[string]fileInspection)
		inspectFile := func(path string) fileInspection {
			clean := filepath.Clean(path)
			cacheKey := kubeconfigPathKey(clean)
			if cached, ok := fileInspections[cacheKey]; ok {
				return cached
			}
			info, err := os.Stat(clean)
			if err != nil {
				if os.IsNotExist(err) {
					res := fileInspection{missing: true}
					fileInspections[cacheKey] = res
					return res
				}
				res := fileInspection{loadErr: err}
				fileInspections[cacheKey] = res
				return res
			}
			if info.IsDir() {
				res := fileInspection{loadErr: fmt.Errorf("path is a directory")}
				fileInspections[cacheKey] = res
				return res
			}
			cfg, err := clientcmd.LoadFromFile(clean)
			if err != nil {
				res := fileInspection{loadErr: err}
				fileInspections[cacheKey] = res
				return res
			}
			ctxs := make(map[string]struct{}, len(cfg.Contexts))
			for ctxName := range cfg.Contexts {
				ctxs[ctxName] = struct{}{}
			}
			res := fileInspection{contexts: ctxs}
			fileInspections[cacheKey] = res
			return res
		}

		var toRebuild []string
		var toDeselect []string
		for _, clusterID := range affectedClusterIDs {
			clients := a.clusterClientsForID(clusterID)
			if clients == nil {
				continue
			}
			key := pathContextKey{
				path:    kubeconfigPathKey(filepath.Clean(clients.kubeconfigPath)),
				context: clients.kubeconfigContext,
			}
			if _, ok := discoverable[key]; ok {
				toRebuild = append(toRebuild, clusterID)
				continue
			}

			inspection := inspectFile(clients.kubeconfigPath)
			switch {
			case inspection.missing:
				a.logger.Info(fmt.Sprintf("Kubeconfig file deleted/renamed for cluster %s, deselecting", clients.meta.Name), "KubeconfigWatcher")
				toDeselect = append(toDeselect, clusterID)
			case inspection.loadErr != nil:
				a.logger.Warn(fmt.Sprintf("Kubeconfig file for cluster %s changed but is temporarily unreadable (%v); keeping selection until next event", clients.meta.Name, inspection.loadErr), "KubeconfigWatcher")
			default:
				if _, exists := inspection.contexts[clients.kubeconfigContext]; exists {
					a.logger.Info(fmt.Sprintf("Kubeconfig context still present on disk for cluster %s; reconnecting", clients.meta.Name), "KubeconfigWatcher")
					toRebuild = append(toRebuild, clusterID)
				} else {
					a.logger.Info(fmt.Sprintf("Kubeconfig context removed/renamed for cluster %s, deselecting", clients.meta.Name), "KubeconfigWatcher")
					toDeselect = append(toDeselect, clusterID)
				}
			}
		}

		if len(toDeselect) > 0 {
			a.deselectClusters(toDeselect)
		}

		for _, clusterID := range toRebuild {
			clients := a.clusterClientsForID(clusterID)
			if clients == nil {
				continue
			}
			a.logger.Info(fmt.Sprintf("Reconnecting cluster %s after kubeconfig change", clients.meta.Name), "KubeconfigWatcher")
			a.teardownClusterSubsystem(clusterID)
			a.rebuildClusterSubsystem(clusterID)
		}
	}

	a.emitEvent("kubeconfig:available-changed")
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

	if len(remainingParsed) > 0 {
		if err := a.updateRefreshSubsystemSelections(remainingParsed); err != nil {
			a.logger.Warn(fmt.Sprintf("Failed to reconcile refresh subsystems after deselect, aborting: %v", err), "KubeconfigWatcher")
			return
		}
	} else {
		a.teardownRefreshSubsystem()
	}

	a.kubeconfigsMu.Lock()
	a.selectedKubeconfigs = append([]string(nil), remainingSelections...)
	a.kubeconfigsMu.Unlock()

	var authManagers []interface{ Shutdown() }
	a.clusterClientsMu.Lock()
	for _, id := range clusterIDs {
		if clients, ok := a.clusterClients[id]; ok {
			if clients != nil && clients.authManager != nil {
				authManagers = append(authManagers, clients.authManager)
			}
			delete(a.clusterClients, id)
		}
	}
	a.clusterClientsMu.Unlock()
	for _, mgr := range authManagers {
		mgr.Shutdown()
	}

	a.settingsMu.Lock()
	if a.appSettings != nil {
		a.appSettings.SelectedKubeconfigs = append([]string(nil), remainingSelections...)
		if err := a.saveAppSettings(); err != nil {
			a.logger.Warn(fmt.Sprintf("Failed to save updated selection: %v", err), "KubeconfigWatcher")
		}
	}
	a.settingsMu.Unlock()
}

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
	if isDefault {
		displayName = "default"
	}

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
	if len(a.availableKubeconfigs) == 0 {
		if err := a.discoverKubeconfigs(); err != nil {
			return nil, err
		}
	}
	return a.availableKubeconfigs, nil
}

// GetSelectedKubeconfig returns the currently selected kubeconfig and context
// Returns in the format "path:context"
func (a *App) GetSelectedKubeconfig() string {
	if a.selectedContext != "" {
		return a.selectedKubeconfig + ":" + a.selectedContext
	}
	return a.selectedKubeconfig
}

// GetSelectedKubeconfigs returns the active kubeconfig selections for multi-cluster support.
func (a *App) GetSelectedKubeconfigs() []string {
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
		return a.clearKubeconfigSelection()
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

// SetSelectedKubeconfigs updates the active kubeconfig selection set for multi-cluster support.
//
// This function is the primary entry point for changing which Kubernetes clusters the application
// is connected to. It is called by the frontend when the user selects one or more clusters from
// the cluster selection UI.
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
	// ===========================================================================================
	// STEP 1: Handle empty selection case
	// ===========================================================================================
	// If the user has deselected all clusters (empty selection), we need to tear down all
	// cluster-related state and connections. This is handled by a separate function since
	// it involves cleanup logic rather than setup logic.
	if len(selections) == 0 {
		return a.clearKubeconfigSelection()
	}

	// ===========================================================================================
	// STEP 2: Capture previous state for change detection
	// ===========================================================================================
	// We need to know if the selection actually changed so we can skip expensive operations
	// (like restarting the refresh subsystem) if the user selected the same clusters they
	// already had selected. We copy the slice to avoid issues if the underlying array is
	// modified during processing.
	previousSelections := append([]string(nil), a.selectedKubeconfigs...)

	// ===========================================================================================
	// STEP 3: Parse, validate, and normalize each selection string
	// ===========================================================================================
	// Selection strings come from the frontend in a format like "path/to/kubeconfig:context-name".
	// We need to:
	//   - Parse them into structured kubeconfigSelection objects
	//   - Validate that the referenced kubeconfig files and contexts actually exist
	//   - Normalize the paths and names for consistent storage and comparison
	//   - Detect and reject duplicate context selections (can't connect to same context twice)
	//
	// We build two parallel slices:
	//   - normalized: structured objects used for creating Kubernetes clients
	//   - normalizedStrings: string representations used for storage and comparison
	normalized := make([]kubeconfigSelection, 0, len(selections))
	normalizedStrings := make([]string, 0, len(selections))
	seenContexts := make(map[string]struct{}, len(selections)) // tracks contexts we've already seen to detect duplicates

	for _, selection := range selections {
		// Parse the selection string into a structured object containing the kubeconfig
		// file path and the context name within that kubeconfig.
		parsed, err := a.normalizeKubeconfigSelection(selection)
		if err != nil {
			return err
		}

		// Validate that the kubeconfig file exists and contains the specified context.
		// This prevents the user from selecting a cluster that doesn't actually exist,
		// which would cause confusing errors later when we try to connect.
		if err := a.validateKubeconfigSelection(parsed); err != nil {
			return err
		}

		// Check for duplicate context selections. Selecting the same context twice would
		// create duplicate connections and cause confusion in the UI. This can happen if
		// the same context appears in multiple kubeconfig files.
		if parsed.Context != "" {
			if _, exists := seenContexts[parsed.Context]; exists {
				return fmt.Errorf("duplicate context selected: %s", parsed.Context)
			}
			seenContexts[parsed.Context] = struct{}{}
		}

		// Add the validated selection to our normalized slices.
		normalized = append(normalized, parsed)
		normalizedStrings = append(normalizedStrings, parsed.String())
	}

	// ===========================================================================================
	// STEP 4: Determine if the selection actually changed
	// ===========================================================================================
	// Compare the new normalized selection with the previous selection to determine if
	// anything actually changed. We do this comparison BEFORE updating any state so we
	// can skip expensive operations if nothing changed.
	//
	// First, check if the counts differ (quick check).
	selectionChanged := len(previousSelections) != len(normalizedStrings)

	// If counts match, compare each element. We compare in order because the order of
	// selections matters (the first selection is the "primary" cluster).
	if !selectionChanged {
		for i, selection := range previousSelections {
			if selection != normalizedStrings[i] {
				selectionChanged = true
				break
			}
		}
	}

	// ===========================================================================================
	// STEP 5: Update in-memory selection state
	// ===========================================================================================
	// Store the new selection in the App's in-memory state. This is used by other parts
	// of the application to know which clusters are currently selected.
	a.selectedKubeconfigs = normalizedStrings

	// ===========================================================================================
	// STEP 6: Persist the selection to disk
	// ===========================================================================================
	// Save the selection to the app settings file so it survives app restarts. On the next
	// app launch, restoreKubeconfigSelection() will read this file and restore the selection,
	// allowing initKubernetesClient() to automatically reconnect to the same clusters.
	//
	// This is critical for the "first run" vs "subsequent run" behavior:
	//   - First run: No settings file exists, so no clusters are auto-selected at startup.
	//                The user must manually select clusters, which calls this function.
	//   - Subsequent runs: Settings file exists with saved selection, so clusters are
	//                      auto-selected at startup via initKubernetesClient().
	if a.appSettings == nil {
		a.appSettings = getDefaultAppSettings()
	}
	a.appSettings.SelectedKubeconfigs = normalizedStrings

	// Also set the legacy single-selection field for backward compatibility.
	// Some older code paths may still reference SelectedKubeconfig (singular).
	if len(normalizedStrings) > 0 {
		a.appSettings.SelectedKubeconfig = normalizedStrings[0]
	} else {
		a.appSettings.SelectedKubeconfig = ""
	}

	// Clear legacy single-selection fields on the App struct to avoid implicit base usage.
	// These fields predate multi-cluster support and should not be used, but we clear them
	// to prevent any old code from accidentally using stale values.
	a.selectedKubeconfig = ""
	a.selectedContext = ""

	// Write the settings to disk. We log but don't fail on error because the selection
	// can still work for this session even if persistence fails.
	if err := a.saveAppSettings(); err != nil {
		a.logger.Warn(fmt.Sprintf("Failed to save kubeconfig selection: %v", err), "KubeconfigManager")
	}

	// ===========================================================================================
	// STEP 7: Create/update Kubernetes API clients for each selected cluster
	// ===========================================================================================
	// The cluster client pool manages Kubernetes API client connections for each cluster.
	// This function creates new clients for newly-selected clusters and removes clients
	// for clusters that are no longer selected. Each cluster needs its own set of clients
	// (clientset, dynamic client, API extensions client, etc.) to communicate with that
	// cluster's API server.
	if err := a.syncClusterClientPool(normalized); err != nil {
		return err
	}

	// ===========================================================================================
	// STEP 8: Initialize or update the refresh subsystem
	// ===========================================================================================
	// The refresh subsystem is the core data pipeline that fetches Kubernetes resources
	// and serves them to the frontend. It consists of:
	//   - An HTTP server that the frontend connects to for data streaming
	//   - Snapshot handlers that fetch and cache Kubernetes resource data
	//   - Stream handlers that push real-time updates to the frontend
	//
	// We only need to do this work if the selection actually changed. If the user selected
	// the same clusters they already had, we can skip this expensive operation.
	if selectionChanged {
		// Check if the refresh subsystem has never been initialized. This happens on first
		// run when the user selects clusters for the first time (as opposed to subsequent
		// runs where initKubernetesClient() initializes it at startup).
		if a.refreshHTTPServer == nil || a.refreshAggregates == nil || a.refreshCtx == nil {
			// First-time initialization: Create the entire refresh subsystem from scratch.
			// This starts the HTTP server, registers all the snapshot and stream handlers,
			// and begins the background refresh loops.
			if err := a.setupRefreshSubsystem(); err != nil {
				return err
			}
		} else {
			// The refresh subsystem already exists (user is changing their selection, not
			// making an initial selection). Update it in-place to add/remove clusters
			// without tearing down and recreating the entire HTTP server.
			if err := a.updateRefreshSubsystemSelections(normalized); err != nil {
				return err
			}
		}

		// ===========================================================================================
		// STEP 9: Start the object catalog service
		// ===========================================================================================
		// The object catalog is a specialized service that powers the "Browse" and "All Objects"
		// views in the frontend. It maintains an in-memory index of all Kubernetes objects
		// across all selected clusters, enabling fast filtering and searching.
		//
		// CRITICAL: This call was previously missing, which caused the "503 Service Unavailable"
		// error on first app run. The refresh subsystem (started above) registers an HTTP handler
		// for /api/v2/stream/catalog, but that handler returns 503 if the catalog service hasn't
		// been started. Without this call, the catalog service was never started when the user
		// selected clusters for the first time.
		//
		// On subsequent app runs, initKubernetesClient() calls startObjectCatalog() at startup,
		// so the issue only manifested on first run when this function was the entry point
		// instead of initKubernetesClient().
		a.startObjectCatalog()
	}

	return nil
}

// clearKubeconfigSelection clears the active selection and resets client state.
func (a *App) clearKubeconfigSelection() error {
	a.logger.Info("Clearing kubeconfig selection", "KubeconfigManager")
	a.selectedKubeconfig = ""
	a.selectedContext = ""
	a.selectedKubeconfigs = nil
	a.client = nil
	a.apiextensionsClient = nil
	a.dynamicClient = nil
	a.restConfig = nil
	a.metricsClient = nil
	a.clusterClientsMu.Lock()
	a.clusterClients = make(map[string]*clusterClients)
	a.clusterClientsMu.Unlock()
	clearGVRCache()
	a.teardownRefreshSubsystem()

	if a.appSettings == nil {
		a.appSettings = getDefaultAppSettings()
	}
	a.appSettings.SelectedKubeconfig = ""
	a.appSettings.SelectedKubeconfigs = nil
	if err := a.saveAppSettings(); err != nil {
		a.logger.Warn(fmt.Sprintf("Failed to save kubeconfig selection: %v", err), "KubeconfigManager")
	}

	a.clusterClientsMu.Lock()
	a.clusterClients = make(map[string]*clusterClients)
	a.clusterClientsMu.Unlock()

	return nil
}

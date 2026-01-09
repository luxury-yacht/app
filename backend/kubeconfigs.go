package backend

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

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
	if selection := a.GetSelectedKubeconfig(); selection != "" {
		return []string{selection}
	}
	return []string{}
}

// SetKubeconfig switches to a different kubeconfig file and context
// The parameter should be in the format "path:context"
func (a *App) SetKubeconfig(selection string) error {
	a.logger.Info(fmt.Sprintf("Switching kubeconfig to: %s", selection), "KubeconfigManager")

	parsed, err := parseKubeconfigSelection(selection)
	if err != nil || parsed.Context == "" {
		a.logger.Error(fmt.Sprintf("Invalid kubeconfig selection format: %s (expected 'path:context')", selection), "KubeconfigManager")
		return fmt.Errorf("invalid selection format, expected 'path:context'")
	}
	if err := a.validateKubeconfigSelection(parsed); err != nil {
		a.logger.Error(fmt.Sprintf("Kubeconfig context not found: %s in %s", parsed.Context, parsed.Path), "KubeconfigManager")
		return err
	}

	// Validate that the file can be loaded
	a.logger.Debug(fmt.Sprintf("Validating kubeconfig file: %s", parsed.Path), "KubeconfigManager")
	_, err = clientcmd.LoadFromFile(parsed.Path)
	if err != nil {
		a.logger.Error(fmt.Sprintf("Invalid kubeconfig file %s: %v", parsed.Path, err), "KubeconfigManager")
		return fmt.Errorf("invalid kubeconfig file: %w", err)
	}

	a.selectedKubeconfigs = []string{parsed.String()}
	if err := a.setBaseKubeconfig(parsed, true); err != nil {
		return err
	}

	if err := a.syncClusterClientPool([]kubeconfigSelection{parsed}); err != nil {
		return err
	}

	a.logger.Info(fmt.Sprintf("Successfully switched to kubeconfig %s with context %s", parsed.Path, parsed.Context), "KubeconfigManager")
	return nil
}

// SetSelectedKubeconfigs updates the active selection set for multi-cluster support.
func (a *App) SetSelectedKubeconfigs(selections []string) error {
	if len(selections) == 0 {
		return a.clearKubeconfigSelection()
	}

	previousSelections := append([]string(nil), a.selectedKubeconfigs...)
	normalized := make([]kubeconfigSelection, 0, len(selections))
	normalizedStrings := make([]string, 0, len(selections))
	seenContexts := make(map[string]struct{}, len(selections))

	for _, selection := range selections {
		parsed, err := a.normalizeKubeconfigSelection(selection)
		if err != nil {
			return err
		}
		if err := a.validateKubeconfigSelection(parsed); err != nil {
			return err
		}
		if parsed.Context != "" {
			if _, exists := seenContexts[parsed.Context]; exists {
				return fmt.Errorf("duplicate context selected: %s", parsed.Context)
			}
			seenContexts[parsed.Context] = struct{}{}
		}
		normalized = append(normalized, parsed)
		normalizedStrings = append(normalizedStrings, parsed.String())
	}

	baseSelection := normalized[0]
	if a.selectedKubeconfig != "" || a.selectedContext != "" {
		for _, selection := range normalized {
			if selection.Path == a.selectedKubeconfig && selection.Context == a.selectedContext {
				baseSelection = selection
				break
			}
		}
	}
	baseChanged := a.selectedKubeconfig != baseSelection.Path || a.selectedContext != baseSelection.Context
	selectionChanged := len(previousSelections) != len(normalizedStrings)
	if !selectionChanged {
		for i, selection := range previousSelections {
			if selection != normalizedStrings[i] {
				selectionChanged = true
				break
			}
		}
	}
	a.selectedKubeconfigs = normalizedStrings

	if a.appSettings == nil {
		a.appSettings = getDefaultAppSettings()
	}
	a.appSettings.SelectedKubeconfigs = normalizedStrings

	if baseChanged {
		if err := a.setBaseKubeconfig(baseSelection, false); err != nil {
			return err
		}
	} else {
		a.appSettings.SelectedKubeconfig = baseSelection.String()
		if err := a.saveAppSettings(); err != nil {
			a.logger.Warn(fmt.Sprintf("Failed to save kubeconfig selection: %v", err), "KubeconfigManager")
		}
		// Rebuild the refresh subsystem so multi-cluster snapshots include the updated selection.
		if selectionChanged {
			if err := a.rebuildRefreshSubsystem("kubeconfig selection updated"); err != nil {
				return err
			}
		}
	}

	if err := a.syncClusterClientPool(normalized); err != nil {
		return err
	}

	return nil
}

// setBaseKubeconfig applies a single kubeconfig selection while optionally updating the selection list.
func (a *App) setBaseKubeconfig(selection kubeconfigSelection, updateSelectionList bool) error {
	// Update selected kubeconfig and context, reset client to force reinitialization
	a.logger.Info("Resetting Kubernetes clients for kubeconfig switch", "KubeconfigManager")
	a.selectedKubeconfig = selection.Path
	a.selectedContext = selection.Context
	a.client = nil
	a.apiextensionsClient = nil
	clearGVRCache()

	// Tear down refresh subsystem so it can be reinitialised with the new kubeconfig
	a.teardownRefreshSubsystem()

	// Reset metrics client so it reconnects using the new REST config
	a.metricsClient = nil

	// Save the selection to app settings
	a.logger.Debug("Saving kubeconfig selection to app settings", "KubeconfigManager")
	if a.appSettings == nil {
		a.appSettings = getDefaultAppSettings()
	}
	a.appSettings.SelectedKubeconfig = selection.String()
	if updateSelectionList {
		a.appSettings.SelectedKubeconfigs = []string{selection.String()}
	}
	if err := a.saveAppSettings(); err != nil {
		a.logger.Warn(fmt.Sprintf("Failed to save kubeconfig selection: %v", err), "KubeconfigManager")
	} else {
		a.logger.Debug("Successfully saved kubeconfig selection", "KubeconfigManager")
	}

	// Reinitialize client with new kubeconfig
	a.logger.Info(fmt.Sprintf("Reinitializing Kubernetes client with %s:%s", selection.Path, selection.Context), "KubeconfigManager")
	if err := a.initKubeClient(); err != nil {
		a.logger.Error(fmt.Sprintf("Failed to initialize client with new kubeconfig: %v", err), "KubeconfigManager")
		return err
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

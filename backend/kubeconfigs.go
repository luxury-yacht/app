package backend

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
)

// discoverKubeconfigs scans the ~/.kube directory for kubeconfig files
func (a *App) discoverKubeconfigs() error {
	a.logger.Debug("Starting kubeconfig discovery", "KubeconfigManager")
	a.availableKubeconfigs = []KubeconfigInfo{}

	home := homedir.HomeDir()
	if home == "" {
		a.logger.Error("Could not find home directory for kubeconfig discovery", "KubeconfigManager")
		return fmt.Errorf("could not find home directory")
	}

	a.logger.Debug(fmt.Sprintf("Using home directory: %s", home), "KubeconfigManager")

	kubeDir := filepath.Join(home, ".kube")
	a.logger.Debug(fmt.Sprintf("Scanning directory: %s", kubeDir), "KubeconfigManager")

	// Check if .kube directory exists
	if _, err := os.Stat(kubeDir); os.IsNotExist(err) {
		a.logger.Warn(".kube directory not found - no kubeconfigs available", "KubeconfigManager")
		return fmt.Errorf(".kube directory not found")
	}

	// Read directory contents (non-recursive)
	entries, err := os.ReadDir(kubeDir)
	if err != nil {
		a.logger.Error(fmt.Sprintf("Failed to read .kube directory: %v", err), "KubeconfigManager")
		return fmt.Errorf("failed to read .kube directory: %w", err)
	}

	a.logger.Debug(fmt.Sprintf("Found %d items in .kube directory", len(entries)), "KubeconfigManager")

	for _, d := range entries {
		// Skip directories - we only want files directly in ~/.kube
		if d.IsDir() {
			continue
		}

		path := filepath.Join(kubeDir, d.Name())

		name := d.Name()

		// Skip obviously non-config files
		if strings.HasPrefix(name, ".") && name != ".kubeconfig" {
			continue
		}

		// Skip common non-kubeconfig files
		skipPatterns := []string{
			".bak", ".backup", ".old", ".tmp", ".swp", ".swo",
			"~", ".orig", ".rej", ".lock", ".log", ".yaml.bak",
		}

		shouldSkip := false
		for _, pattern := range skipPatterns {
			if strings.HasSuffix(strings.ToLower(name), pattern) {
				shouldSkip = true
				break
			}
		}
		if shouldSkip {
			continue
		}

		// Skip files that are clearly not kubeconfigs by name pattern
		if strings.Contains(strings.ToLower(name), "cache") ||
			strings.Contains(strings.ToLower(name), "token") ||
			strings.Contains(strings.ToLower(name), "credential") {
			continue
		}

		// Try to parse the file as a kubeconfig to validate it
		a.logger.Debug(fmt.Sprintf("Validating kubeconfig file: %s", path), "KubeconfigManager")
		config, err := clientcmd.LoadFromFile(path)
		if err != nil {
			a.logger.Debug(fmt.Sprintf("Skipping %s - not a valid kubeconfig: %v", path, err), "KubeconfigManager")
			// Skip files that can't be parsed as kubeconfig
			continue
		}

		// Additional validation: ensure it has clusters and contexts
		if len(config.Clusters) == 0 || len(config.Contexts) == 0 {
			a.logger.Debug(fmt.Sprintf("Skipping %s - no clusters or contexts found", path), "KubeconfigManager")
			continue
		}

		a.logger.Info(fmt.Sprintf("Found valid kubeconfig: %s (%d clusters, %d contexts)", path, len(config.Clusters), len(config.Contexts)), "KubeconfigManager")

		// Determine display name
		displayName := name
		if name == "config" {
			displayName = "default"
		}

		// Check if this is the default kubeconfig
		isDefault := name == "config"

		// Create an entry for each context in the kubeconfig
		for contextName := range config.Contexts {
			a.availableKubeconfigs = append(a.availableKubeconfigs, KubeconfigInfo{
				Name:             displayName,
				Path:             path,
				Context:          contextName,
				IsDefault:        isDefault,
				IsCurrentContext: contextName == config.CurrentContext,
			})
		}
	}

	return nil
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

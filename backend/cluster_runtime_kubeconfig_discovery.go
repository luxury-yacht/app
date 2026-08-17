package backend

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"k8s.io/client-go/tools/clientcmd"
)

// discoverKubeconfigs scans configured kubeconfig search paths for kubeconfig files.
func (m *ClusterRuntimeManager) discoverKubeconfigs() error {
	m.discoveryMu.Lock()
	defer m.discoveryMu.Unlock()
	return m.discoverKubeconfigsLocked()
}

func (m *ClusterRuntimeManager) discoverKubeconfigsLocked() error {
	m.logger.Debug("Starting kubeconfig discovery", logsources.KubeconfigManager)
	m.availableKubeconfigs = []KubeconfigInfo{}
	m.discoveryRepository.SetDiscoveredKubeconfigSearchPaths(nil)
	m.kubeconfigDiscoveryState = KubeconfigDiscoveryStateNoKubeconfigs

	searchPaths, err := m.loadKubeconfigSearchPaths()
	if err != nil {
		m.logger.ErrorWithCause(err, "Failed to load kubeconfig search paths", logsources.KubeconfigManager)
		return err
	}
	m.discoveryRepository.SetDiscoveredKubeconfigSearchPaths(searchPaths)
	if len(searchPaths) == 0 {
		m.logger.Warn("No kubeconfig search paths configured", logsources.KubeconfigManager)
		m.kubeconfigDiscoveryState = KubeconfigDiscoveryStateSearchPathsMissing
		return nil
	}

	defaultConfigPath := resolveKubeconfigSearchPath(filepath.Join("~", ".kube", "config"))
	foundRoot := false
	seenFiles := make(map[string]struct{})

	for _, entry := range searchPaths {
		foundRoot = m.discoverKubeconfigsAtPath(entry, defaultConfigPath, seenFiles) || foundRoot
	}

	if !foundRoot {
		m.kubeconfigDiscoveryState = KubeconfigDiscoveryStateSearchPathsMissing
		return nil
	}
	if len(m.availableKubeconfigs) > 0 {
		m.kubeconfigDiscoveryState = KubeconfigDiscoveryStateAvailable
	}

	return nil
}

func (m *ClusterRuntimeManager) discoverKubeconfigsAtPath(entry, defaultConfigPath string, seenFiles map[string]struct{}) bool {
	resolved := resolveKubeconfigSearchPath(entry)
	if resolved == "" {
		return false
	}
	info, err := os.Stat(resolved)
	if err != nil {
		m.logKubeconfigPathReadError(resolved, err)
		return false
	}
	if !info.IsDir() {
		m.appendKubeconfigFromFile(resolved, filepath.Base(resolved), defaultConfigPath, false, seenFiles)
		return true
	}

	m.logger.Debug(fmt.Sprintf("Scanning directory: %s", resolved), logsources.KubeconfigManager)
	entries, err := os.ReadDir(resolved)
	if err != nil {
		m.logger.Warn(fmt.Sprintf("Failed to read kubeconfig directory %s: %v", resolved, err), logsources.KubeconfigManager)
		return true
	}
	m.logger.Debug(fmt.Sprintf("Found %d items in %s", len(entries), resolved), logsources.KubeconfigManager)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		path := filepath.Join(resolved, entry.Name())
		m.appendKubeconfigFromFile(path, entry.Name(), defaultConfigPath, true, seenFiles)
	}
	return true
}

func (m *ClusterRuntimeManager) logKubeconfigPathReadError(path string, err error) {
	if os.IsNotExist(err) {
		m.logger.Warn(fmt.Sprintf("Kubeconfig path not found: %s", path), logsources.KubeconfigManager)
		return
	}
	m.logger.Warn(fmt.Sprintf("Failed to read kubeconfig path %s: %v", path, err), logsources.KubeconfigManager)
}

// appendKubeconfigFromFile validates a kubeconfig file and appends its contexts.
func (m *ClusterRuntimeManager) appendKubeconfigFromFile(path string, name string, defaultConfigPath string, applyHeuristics bool, seenFiles map[string]struct{}) {
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
	m.logger.Debug(fmt.Sprintf("Validating kubeconfig file: %s", cleanedPath), logsources.KubeconfigManager)
	config, err := clientcmd.LoadFromFile(cleanedPath)
	if err != nil {
		m.logger.Debug(fmt.Sprintf("Skipping %s - not a valid kubeconfig: %v", cleanedPath, err), logsources.KubeconfigManager)
		return
	}

	// Additional validation: ensure it has clusters and contexts.
	if len(config.Clusters) == 0 || len(config.Contexts) == 0 {
		m.logger.Debug(fmt.Sprintf("Skipping %s - no clusters or contexts found", cleanedPath), logsources.KubeconfigManager)
		return
	}

	isDefault := pathsEqual(cleanedPath, defaultConfigPath)
	displayName := name

	m.logger.Info(fmt.Sprintf("Found valid kubeconfig: %s (%d clusters, %d contexts)", cleanedPath, len(config.Clusters), len(config.Contexts)), logsources.KubeconfigManager)

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
		m.availableKubeconfigs = append(m.availableKubeconfigs, KubeconfigInfo{
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

// loadKubeconfigSearchPaths reads and normalizes the kubeconfig search paths.
func (m *ClusterRuntimeManager) loadKubeconfigSearchPaths() ([]string, error) {
	return m.discoveryRepository.KubeconfigSearchPaths()
}

func (m *ClusterRuntimeManager) refreshKubeconfigDiscoveryAndWatch() error {
	if err := m.discoverKubeconfigs(); err != nil {
		return err
	}
	if m.kubeconfigWatcher == nil {
		return nil
	}
	return m.kubeconfigWatcher.updateWatchedPaths(m.resolvedKubeconfigWatchPaths())
}

// GetKubeconfigs returns the available kubeconfigs and the current discovery state.
func (m *ClusterRuntimeManager) GetKubeconfigs() (KubeconfigDiscoveryResult, error) {
	m.discoveryMu.RLock()
	if len(m.availableKubeconfigs) > 0 {
		result := KubeconfigDiscoveryResult{
			Kubeconfigs: append([]KubeconfigInfo(nil), m.availableKubeconfigs...),
			State:       KubeconfigDiscoveryStateAvailable,
			SearchPaths: m.discoveryRepository.DiscoveredKubeconfigSearchPaths(),
		}
		m.discoveryMu.RUnlock()
		return result, nil
	}
	m.discoveryMu.RUnlock()

	if err := m.discoverKubeconfigs(); err != nil {
		return KubeconfigDiscoveryResult{}, err
	}

	m.discoveryMu.RLock()
	defer m.discoveryMu.RUnlock()
	return KubeconfigDiscoveryResult{
		Kubeconfigs: append([]KubeconfigInfo(nil), m.availableKubeconfigs...),
		State:       m.kubeconfigDiscoveryState,
		SearchPaths: m.discoveryRepository.DiscoveredKubeconfigSearchPaths(),
	}, nil
}

// startKubeconfigWatcher creates and starts the kubeconfig directory watcher.
func (m *ClusterRuntimeManager) startKubeconfigWatcher() error {
	if m.kubeconfigWatcher != nil {
		return nil
	}

	w, err := newKubeconfigWatcher(m.logger, func(paths []string) {
		m.intents.Publish(ClusterRuntimeIntent{
			Kind:       ClusterRuntimeIntentKubeconfigSourceChanged,
			Generation: m.intentGeneration.Add(1),
			Paths:      paths,
		})
	})
	if err != nil {
		return err
	}
	m.kubeconfigWatcher = w

	watchPaths := m.resolvedKubeconfigWatchPaths()
	if err := w.updateWatchedPaths(watchPaths); err != nil {
		m.logger.Warn(fmt.Sprintf("Failed to set watched paths: %v", err), logsources.KubeconfigWatcher)
	}

	m.logger.Info(fmt.Sprintf("Kubeconfig watcher started, watching %d path(s)", len(watchPaths)), logsources.KubeconfigWatcher)
	return nil
}

// stopKubeconfigWatcher stops the kubeconfig directory watcher if running.
func (m *ClusterRuntimeManager) stopKubeconfigWatcher() {
	if m.kubeconfigWatcher == nil {
		return
	}
	m.kubeconfigWatcher.stop()
	m.kubeconfigWatcher = nil
}

// resolvedKubeconfigWatchPaths returns watchedPath entries for configured search paths.
func (m *ClusterRuntimeManager) resolvedKubeconfigWatchPaths() []watchedPath {
	searchPaths, err := m.loadKubeconfigSearchPaths()
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

func (m *ClusterRuntimeManager) affectedKubeconfigClusters(changedPaths map[string]struct{}) []string {
	m.clusterClientsMu.Lock()
	defer m.clusterClientsMu.Unlock()
	var affected []string
	for id, clients := range m.clusterClients {
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

func (m *ClusterRuntimeManager) availableKubeconfigCount() int {
	m.discoveryMu.RLock()
	defer m.discoveryMu.RUnlock()
	return len(m.availableKubeconfigs)
}

func (m *ClusterRuntimeManager) discoverableKubeconfigSelections() map[kubeconfigSelectionKey]struct{} {
	m.discoveryMu.RLock()
	defer m.discoveryMu.RUnlock()
	discoverable := make(map[kubeconfigSelectionKey]struct{}, len(m.availableKubeconfigs))
	for _, kubeconfig := range m.availableKubeconfigs {
		discoverable[newKubeconfigSelectionKey(kubeconfig.Path, kubeconfig.Context)] = struct{}{}
	}
	return discoverable
}

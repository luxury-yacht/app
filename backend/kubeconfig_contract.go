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

// selectionChangeIntent captures the parsed/validated selection intent before runtime work begins.
type selectionChangeIntent struct {
	generation              uint64
	normalizedSelections    []kubeconfigSelection
	normalizedSelectionText []string
	selectionChanged        bool
	clearSelection          bool
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

func newKubeconfigSelectionKey(path, contextName string) kubeconfigSelectionKey {
	return kubeconfigSelectionKey{path: kubeconfigPathKey(filepath.Clean(path)), context: contextName}
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

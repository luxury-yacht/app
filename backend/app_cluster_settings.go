package backend

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"k8s.io/apimachinery/pkg/util/validation"

	"github.com/luxury-yacht/app/backend/internal/logsources"
)

// Per-cluster namespace scope ("accessible namespaces",
// docs/plans/namespace-scope.md). The scope is persisted in the Clusters
// section of settings.json keyed by clusterId and, when non-empty, makes all
// namespaced data paths for that cluster run per-namespace instead of
// cluster-wide (enforcement lands in later plan phases).

// GetClusterAllowedNamespaces returns the persisted namespace scope for the
// cluster in the order the user saved it. Empty means no scope.
func (a *App) GetClusterAllowedNamespaces(clusterID string) ([]string, error) {
	if clusterID == "" {
		return nil, fmt.Errorf("clusterID is required")
	}
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()
	settings, err := a.loadSettingsFile()
	if err != nil {
		return nil, err
	}
	return append([]string(nil), settings.Clusters[clusterID].AllowedNamespaces...), nil
}

// SetClusterAllowedNamespaces validates, normalizes, and persists the
// namespace scope for one cluster, then requests a rebuild of that cluster's
// refresh subsystem when the scope's namespace SET changed — reordering
// persists but does not rebuild. It returns the normalized list. An
// empty/nil list clears the scope. The whole batch is rejected on the first
// invalid name: nothing is persisted and no rebuild is requested.
func (a *App) SetClusterAllowedNamespaces(clusterID string, namespaces []string) ([]string, error) {
	if clusterID == "" {
		return nil, fmt.Errorf("clusterID is required")
	}
	normalized, err := normalizeAllowedNamespaces(namespaces)
	if err != nil {
		return nil, err
	}

	a.settingsMu.Lock()
	settings, err := a.loadSettingsFile()
	if err != nil {
		a.settingsMu.Unlock()
		return nil, err
	}
	previous := settings.Clusters[clusterID].AllowedNamespaces
	section := settings.Clusters[clusterID]
	scopeChanged := !equalStringSets(previous, normalized)
	if !slices.Equal(previous, normalized) {
		section.AllowedNamespaces = normalized
		if clusterSettingsSectionEmpty(section) {
			delete(settings.Clusters, clusterID)
		} else {
			if settings.Clusters == nil {
				settings.Clusters = map[string]settingsClusterSection{}
			}
			settings.Clusters[clusterID] = section
		}
		if err := a.saveSettingsFile(settings); err != nil {
			a.settingsMu.Unlock()
			return nil, err
		}
	}
	a.settingsMu.Unlock()

	// Persist BEFORE rebuilding so the rebuilt subsystem reads the new scope.
	if scopeChanged {
		a.requestClusterScopeRebuild(clusterID)
	}
	return normalized, nil
}

func clusterSettingsSectionEmpty(section settingsClusterSection) bool {
	return len(section.AllowedNamespaces) == 0 &&
		(section.Attention == nil ||
			(len(section.Attention.ObjectFindings) == 0 && len(section.Attention.FindingTypes) == 0))
}

// allowedNamespacesForCluster is the subsystem-construction read of the
// persisted scope. A settings read failure degrades to cluster-wide (empty)
// with a warning — the same degradation every settings consumer applies when
// settings.json is unreadable — rather than failing the whole cluster build.
func (a *App) allowedNamespacesForCluster(clusterID string) []string {
	namespaces, err := a.GetClusterAllowedNamespaces(clusterID)
	if err != nil {
		a.logger.Warn(
			fmt.Sprintf("Could not read allowed namespaces for cluster %s (running cluster-wide): %v", clusterID, err),
			logsources.Settings, clusterID, clusterID,
		)
		return nil
	}
	return namespaces
}

// requestClusterScopeRebuild rebuilds one cluster's refresh subsystem so a
// changed namespace scope takes effect. It runs through the coordinated
// selection-mutation + per-cluster operation path (the same routing auth
// recovery uses), and rapid successive edits coalesce: while a rebuild is
// QUEUED, further requests are dropped — the queued rebuild reads the latest
// persisted scope; once it STARTS, the next edit queues a fresh one. The
// rebuild recreates the permission checker, so the SSAR cache resets with
// it. A cluster that is not currently connected has nothing to rebuild; its
// persisted scope applies on the next connect.
func (a *App) requestClusterScopeRebuild(clusterID string) {
	if a.requestClusterScopeRebuildFn != nil {
		a.requestClusterScopeRebuildFn(clusterID)
		return
	}
	if a.clusterClientsForID(clusterID) == nil {
		return
	}
	if !a.tryQueueScopeRebuild(clusterID) {
		return
	}
	a.runSelectionMutationAsync(fmt.Sprintf("cluster-scope-rebuild:%s", clusterID), func(_ *selectionMutation) error {
		return a.runClusterOperation(context.Background(), clusterID, func(opCtx context.Context) error {
			// From here on this rebuild may already be reading the previous
			// scope, so a new edit must queue a fresh rebuild.
			a.markScopeRebuildStarted(clusterID)
			if err := opCtx.Err(); err != nil {
				return err
			}
			a.performClusterScopeRebuild(clusterID)
			return opCtx.Err()
		})
	})
}

// tryQueueScopeRebuild reports whether the caller should enqueue a scope
// rebuild for the cluster: false while one is already queued (the pending
// rebuild will read the caller's just-persisted scope anyway).
func (a *App) tryQueueScopeRebuild(clusterID string) bool {
	_, alreadyQueued := a.scopeRebuildQueued.LoadOrStore(clusterID, struct{}{})
	return !alreadyQueued
}

// markScopeRebuildStarted releases the cluster's queued slot at rebuild
// start, so edits landing mid-rebuild queue a fresh one.
func (a *App) markScopeRebuildStarted(clusterID string) {
	a.scopeRebuildQueued.Delete(clusterID)
}

// performClusterScopeRebuild tears down and rebuilds the cluster's subsystem
// (the kubeconfig-change pattern), then emits cluster:scope:changed so the
// frontend restarts the cluster's streams and refetches its domains — without
// this event the sidebar would keep serving the pre-rebuild snapshot (the
// namespaces list would never show a newly added scope entry).
func (a *App) performClusterScopeRebuild(clusterID string) {
	a.teardownClusterSubsystem(clusterID)
	a.rebuildClusterSubsystem(clusterID)
	a.emitEvent("cluster:scope:changed", map[string]any{"clusterId": clusterID})
}

// normalizeAllowedNamespaces trims entries, drops empties, dedupes while
// preserving first-seen order, and rejects any name that is not a valid
// DNS-1123 label (the namespace name grammar).
func normalizeAllowedNamespaces(namespaces []string) ([]string, error) {
	normalized := make([]string, 0, len(namespaces))
	seen := make(map[string]struct{}, len(namespaces))
	for _, raw := range namespaces {
		name := strings.TrimSpace(raw)
		if name == "" {
			continue
		}
		if errs := validation.IsDNS1123Label(name); len(errs) > 0 {
			return nil, fmt.Errorf("invalid namespace name %q: %s", name, strings.Join(errs, "; "))
		}
		if _, dup := seen[name]; dup {
			continue
		}
		seen[name] = struct{}{}
		normalized = append(normalized, name)
	}
	return normalized, nil
}

// equalStringSets reports whether two already-deduplicated slices contain the
// same members regardless of order.
func equalStringSets(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	members := make(map[string]struct{}, len(a))
	for _, s := range a {
		members[s] = struct{}{}
	}
	for _, s := range b {
		if _, ok := members[s]; !ok {
			return false
		}
	}
	return true
}

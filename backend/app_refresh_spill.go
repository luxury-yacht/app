package backend

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

// app_refresh_spill.go wires the querypage maintained-store spill into the governor's
// Cold/re-warm lifecycle: a Cold cluster's stores are flushed to disk before its heap is
// reclaimed (spillClusterStores, from teardownClusterSubsystem), and a re-warm re-paints
// the freshly-built stores from disk before the informers feed (restoreClusterStores, from
// rebuildClusterSubsystem), then reconciles them once the subsystem syncs. The spill is
// transient cache (re-warm speed only, never user data) and session-scoped — resetSpillRoot
// clears it at startup so a re-warm only restores what THIS session wrote.

// spillRootDir is the directory under which each cluster's spill files live. It sits under
// the user cache dir (transient data). Tests override it via App.spillRoot.
func (a *App) spillRootDir() (string, error) {
	if a.spillRoot != "" {
		return a.spillRoot, nil
	}
	cacheDir, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(cacheDir, "luxury-yacht", "spill"), nil
}

// clusterSpillDir is the per-cluster spill directory. The clusterID is hashed so an
// arbitrary identifier is filesystem-safe and one cluster's files never collide with
// another's.
func (a *App) clusterSpillDir(clusterID string) (string, error) {
	root, err := a.spillRootDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, hashClusterID(clusterID)), nil
}

// hashClusterID renders a stable, filesystem-safe directory name for a clusterID.
func hashClusterID(clusterID string) string {
	sum := sha256.Sum256([]byte(clusterID))
	return hex.EncodeToString(sum[:8])
}

// resetSpillRoot clears the spill root once at session start, so a re-warm only ever
// restores spill files THIS session wrote. Resuming a persisted store across app restarts
// (cold-start-from-disk with resume-from-RV + 410-Gone reconcile) is Tier 2.5's job;
// keeping 2.4's spill session-scoped avoids accidentally serving last session's data.
// Best-effort: the spill is transient, so a clear failure is non-fatal.
func (a *App) resetSpillRoot() {
	if a == nil {
		return
	}
	root, err := a.spillRootDir()
	if err != nil || root == "" {
		return
	}
	_ = os.RemoveAll(root)
}

// spillClusterStores flushes a cluster's maintained stores to its spill directory before
// its heap is reclaimed on Cold, so a re-warm can re-paint them fast. Best-effort: a spill
// failure must not block teardown (the cluster simply re-syncs from scratch on re-warm).
func (a *App) spillClusterStores(clusterID string, reg *domain.Registry) {
	if a == nil || reg == nil {
		return
	}
	dir, err := a.clusterSpillDir(clusterID)
	if err != nil {
		return
	}
	if err := reg.SpillMaintainedStores(dir); err != nil && a.logger != nil {
		a.logger.Warn(fmt.Sprintf("spill maintained stores for cluster %s: %v", clusterID, err), logsources.Refresh, clusterID, a.clusterNameForID(clusterID))
	}
}

// restoreClusterStores re-paints a cluster's freshly-built maintained stores from its spill
// directory on re-warm, BEFORE the informers feed, so the view is instant. Restored rows
// may be stale; they are reconciled after the subsystem syncs (ReconcileMaintainedStores)
// and by the fresh reflectors' initial Replace. Best-effort: a restore failure just means a
// cold (blank-until-synced) re-warm.
func (a *App) restoreClusterStores(clusterID string, reg *domain.Registry) {
	if a == nil || reg == nil {
		return
	}
	dir, err := a.clusterSpillDir(clusterID)
	if err != nil {
		return
	}
	if err := reg.RestoreMaintainedStores(dir); err != nil && a.logger != nil {
		a.logger.Warn(fmt.Sprintf("restore maintained stores for cluster %s: %v", clusterID, err), logsources.Refresh, clusterID, a.clusterNameForID(clusterID))
	}
}

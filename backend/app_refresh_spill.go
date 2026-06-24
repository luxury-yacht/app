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

// spillFormatMarkerFile names the file at the spill root that records the spill format the
// existing spill files were written with, so an app upgrade that changes a row struct does
// not restore incompatible rows.
const spillFormatMarkerFile = "format-version"

// resetSpillRoot unconditionally clears the spill root. It is the discard primitive
// resetSpillRootForFormat uses; best-effort, since the spill is transient cache.
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

// spillFormatVersion is the version the current build's spill files are written with. A
// change between sessions (an app upgrade that may have changed a row struct) invalidates
// the on-disk spill. Tests override via App.spillFormat.
func (a *App) spillFormatVersion() string {
	if a.spillFormat != "" {
		return a.spillFormat
	}
	return Version
}

// resetSpillRootForFormat is the session-start spill policy (Tier 2.5 stage 2): if the spill
// root's recorded format matches this build's, the previous session's spill is KEPT so the
// initial cluster build can re-paint from disk before any network call (cross-restart
// warm-paint); otherwise — a missing marker (first run) or a format change (upgrade) — the
// spill is discarded and the current format stamped, so incompatible rows are never restored.
// Any residual decode mismatch within a version is still skipped per-store on restore, so
// this guard is the proactive layer, not the only safety. Best-effort.
func (a *App) resetSpillRootForFormat() {
	if a == nil {
		return
	}
	root, err := a.spillRootDir()
	if err != nil || root == "" {
		return
	}
	marker := filepath.Join(root, spillFormatMarkerFile)
	current := a.spillFormatVersion()
	if existing, rerr := os.ReadFile(marker); rerr == nil && string(existing) == current {
		return // compatible spill from a previous session — keep it for cross-restart warm-paint
	}
	a.resetSpillRoot()
	if err := os.MkdirAll(root, 0o755); err != nil {
		return
	}
	_ = os.WriteFile(marker, []byte(current), 0o644)
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

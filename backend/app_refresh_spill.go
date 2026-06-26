package backend

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
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

// clusterIngestSpillDir is the per-cluster directory for the ingest stores' Bundle spill — a
// subdir of clusterSpillDir, so the stage-2 format-version guard (which clears the whole spill
// root on an app upgrade) covers it too, keeping the maintained and ingest spills in lockstep.
func (a *App) clusterIngestSpillDir(clusterID string) (string, error) {
	dir, err := a.clusterSpillDir(clusterID)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "ingest"), nil
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

// spillClusterIngestStores flushes a cluster's ingest stores (the projected Bundles + their
// per-GVR resourceVersion) on Cold, so a re-warm can resume each watch from the persisted RV
// (delta) instead of a full re-LIST. Best-effort: a failure just means that kind full-syncs.
func (a *App) spillClusterIngestStores(clusterID string, im *ingest.IngestManager) {
	if a == nil || im == nil {
		return
	}
	dir, err := a.clusterIngestSpillDir(clusterID)
	if err != nil {
		return
	}
	if err := im.SpillStores(dir); err != nil && a.logger != nil {
		a.logger.Warn(fmt.Sprintf("spill ingest stores for cluster %s: %v", clusterID, err), logsources.Refresh, clusterID, a.clusterNameForID(clusterID))
	}
}

// restoreClusterIngestStores restores a cluster's ingest stores from disk before its reflectors
// start, setting each kind's resume RV so Start resumes the watch from it. Best-effort: a
// missing/corrupt spill leaves that kind to full-sync (no regression). Must be called before
// the manager starts.
func (a *App) restoreClusterIngestStores(clusterID string, im *ingest.IngestManager) {
	if a == nil || im == nil {
		return
	}
	dir, err := a.clusterIngestSpillDir(clusterID)
	if err != nil {
		return
	}
	im.RestoreStores(dir)
}

// clusterCooledMmapDir is the per-cluster directory the cooled maintained stores' mmap column
// files live in. It is a subdir of clusterSpillDir, so the stage-2 format-version guard (which
// clears the whole spill root on app upgrade) covers it too, and it never collides with the
// columnar warm-paint spill files in the parent directory.
func (a *App) clusterCooledMmapDir(clusterID string) (string, error) {
	dir, err := a.clusterSpillDir(clusterID)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "cooled"), nil
}

// setCooledClosers records the mmap closers for a cooled cluster so the re-warm/teardown path
// can release the mappings exactly once. Guarded by cooledMu.
func (a *App) setCooledClosers(clusterID string, closers []func() error) {
	if a == nil || clusterID == "" {
		return
	}
	a.cooledMu.Lock()
	defer a.cooledMu.Unlock()
	if a.cooledMmapClosers == nil {
		a.cooledMmapClosers = make(map[string][]func() error)
	}
	a.cooledMmapClosers[clusterID] = closers
}

// takeCooledClosers removes and returns a cooled cluster's mmap closers, returning nil after
// the first call — so a re-warm followed by a teardown (or vice versa) closes each mapping
// exactly once and never double-unmaps. Guarded by cooledMu.
func (a *App) takeCooledClosers(clusterID string) []func() error {
	if a == nil || clusterID == "" {
		return nil
	}
	a.cooledMu.Lock()
	defer a.cooledMu.Unlock()
	closers := a.cooledMmapClosers[clusterID]
	delete(a.cooledMmapClosers, clusterID)
	return closers
}

// closeCooledClosers takes and runs a cooled cluster's mmap closers (a no-op if it was never
// cooled or already re-warmed). Each store-level closer waits for any in-flight Query and
// unmaps once, so this is safe to call only AFTER the cooled subsystem is unrouted (no new
// Build can reach the mmap stores). Best-effort: a closer error is logged, not propagated.
func (a *App) closeCooledClosers(clusterID string) {
	for _, closer := range a.takeCooledClosers(clusterID) {
		if closer == nil {
			continue
		}
		if err := closer(); err != nil && a.logger != nil {
			a.logger.Warn(fmt.Sprintf("close cooled mmap for cluster %s: %v", clusterID, err), logsources.Refresh, clusterID, a.clusterNameForID(clusterID))
		}
	}
}

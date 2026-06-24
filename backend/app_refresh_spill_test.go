package backend

import (
	"encoding/gob"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/refresh/domain"
)

// spillFake is a domain.SpillableStore that persists its rows so the App's spill/restore
// helpers can be exercised end-to-end against the real per-cluster directory layout.
type spillFake struct {
	rows       []string
	restored   []string
	reconciled bool
}

func (s *spillFake) SpillTo(path string) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return gob.NewEncoder(f).Encode(s.rows)
}

func (s *spillFake) RestoreFrom(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return gob.NewDecoder(f).Decode(&s.restored)
}

func (s *spillFake) Reconcile() { s.reconciled = true }

// TestAppClusterStoresSpillRestoreRoundTrip proves the governor's Cold/re-warm wiring: a
// cluster's maintained stores spilled on Cold are restored into the freshly-built stores on
// re-warm, through the real per-cluster spill directory.
func TestAppClusterStoresSpillRestoreRoundTrip(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.spillRoot = t.TempDir()

	reg := domain.New()
	reg.RegisterMaintainedStore("namespace-config", &spillFake{rows: []string{"cm-a", "cm-b"}})
	app.spillClusterStores("cluster-1", reg)

	reg2 := domain.New()
	target := &spillFake{}
	reg2.RegisterMaintainedStore("namespace-config", target)
	app.restoreClusterStores("cluster-1", reg2)

	require.Equal(t, []string{"cm-a", "cm-b"}, target.restored, "re-warm restores what Cold spilled")
}

// TestAppClusterSpillDirIsPerClusterAndStable proves the spill directory is stable across
// calls (so a re-warm finds the files Cold wrote) and isolated per cluster (multi-cluster).
func TestAppClusterSpillDirIsPerClusterAndStable(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.spillRoot = t.TempDir()

	d1a, err := app.clusterSpillDir("cluster-1")
	require.NoError(t, err)
	d1b, err := app.clusterSpillDir("cluster-1")
	require.NoError(t, err)
	d2, err := app.clusterSpillDir("cluster-2")
	require.NoError(t, err)

	require.Equal(t, d1a, d1b, "stable across calls — the spill files survive a re-warm")
	require.NotEqual(t, d1a, d2, "per-cluster isolation")
}

// TestAppResetSpillRootClearsLastSession proves the spill is session-scoped: a startup
// reset removes the previous session's spill files so a re-warm never restores stale
// cross-session data (cold-start-from-disk across restarts is Tier 2.5).
func TestAppResetSpillRootClearsLastSession(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.spillRoot = t.TempDir()

	reg := domain.New()
	reg.RegisterMaintainedStore("namespace-config", &spillFake{rows: []string{"x"}})
	app.spillClusterStores("cluster-1", reg)

	dir, err := app.clusterSpillDir("cluster-1")
	require.NoError(t, err)
	require.FileExists(t, filepath.Join(dir, "namespace-config.spill"))

	app.resetSpillRoot()
	require.NoFileExists(t, filepath.Join(dir, "namespace-config.spill"))
}

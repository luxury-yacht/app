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

	// swapped records the file SwapToMmap wrote; swapErr forces a cool failure; closed counts
	// closer invocations (to prove the app calls each closer exactly once).
	swapped string
	swapErr error
	closed  *int
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

func (s *spillFake) SwapToMmap(path string) (func() error, error) {
	if s.swapErr != nil {
		return nil, s.swapErr
	}
	s.swapped = path
	count := 0
	s.closed = &count
	return func() error { count++; return nil }, nil
}

// TestAppCloseCooledClosersRunsEachExactlyOnce proves the app's cooled-closer bookkeeping:
// closers stored on cool are taken+run exactly once, and a second close (a re-warm followed by
// a teardown, or a double re-warm) is a no-op — never a double-unmap.
func TestAppCloseCooledClosersRunsEachExactlyOnce(t *testing.T) {
	app := newTestAppWithDefaults(t)

	var aCount, bCount int
	app.setCooledClosers("cluster-1", []func() error{
		func() error { aCount++; return nil },
		func() error { bCount++; return nil },
	})

	app.closeCooledClosers("cluster-1")
	require.Equal(t, 1, aCount)
	require.Equal(t, 1, bCount)

	// Second call: the closers were already taken, so this is a no-op (no double-unmap).
	app.closeCooledClosers("cluster-1")
	require.Equal(t, 1, aCount, "closer must not run twice")
	require.Equal(t, 1, bCount, "closer must not run twice")
}

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

// TestClusterIngestSpillDir proves the ingest spill lives in a per-cluster subdir of the
// maintained-store spill dir, so the format-version guard (which clears the spill root)
// covers both, and one cluster's ingest spill never collides with another's.
func TestClusterIngestSpillDir(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.spillRoot = t.TempDir()

	base1, err := app.clusterSpillDir("cluster-1")
	require.NoError(t, err)
	ing1, err := app.clusterIngestSpillDir("cluster-1")
	require.NoError(t, err)
	ing1b, err := app.clusterIngestSpillDir("cluster-1")
	require.NoError(t, err)
	ing2, err := app.clusterIngestSpillDir("cluster-2")
	require.NoError(t, err)

	require.Equal(t, filepath.Join(base1, "ingest"), ing1, "ingest spill is a subdir of the cluster spill dir")
	require.Equal(t, ing1, ing1b, "stable across calls")
	require.NotEqual(t, ing1, ing2, "per-cluster isolation")
}

// TestAppResetSpillRootClearsLastSession proves the unconditional clear primitive removes
// the spill files (used by the format-gated reset on an incompatible/missing marker).
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

// TestResetSpillRootForFormat proves the cross-restart contract: a same-version restart
// KEEPS the previous session's spill (so cold-start re-paints from disk), while a format
// change (app upgrade) CLEARS the now-incompatible spill rather than restoring stale/wrong
// rows.
func TestResetSpillRootForFormat(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.spillRoot = t.TempDir()
	app.spillFormat = "v1"

	// First startup (no marker yet): the gated reset clears + stamps the current format.
	app.resetSpillRootForFormat()

	// This session spills a store.
	reg := domain.New()
	reg.RegisterMaintainedStore("namespace-config", &spillFake{rows: []string{"x"}})
	app.spillClusterStores("cluster-1", reg)
	dir, err := app.clusterSpillDir("cluster-1")
	require.NoError(t, err)
	require.FileExists(t, filepath.Join(dir, "namespace-config.spill"))

	// Same-version restart: the spill is kept (cross-restart warm-paint).
	app.resetSpillRootForFormat()
	require.FileExists(t, filepath.Join(dir, "namespace-config.spill"),
		"a same-version restart must keep the spill for cold-start warm-paint")

	// Upgrade to a new format: the incompatible spill is discarded.
	app.spillFormat = "v2"
	app.resetSpillRootForFormat()
	require.NoFileExists(t, filepath.Join(dir, "namespace-config.spill"),
		"a format change must clear the incompatible spill")
}

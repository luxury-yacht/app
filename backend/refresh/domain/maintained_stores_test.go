package domain

import (
	"encoding/gob"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// fakeSpillable is a SpillableStore that persists its rows to the spill file so a
// separate instance can restore them — exercising the registry's filename derivation and
// the real file plumbing without depending on the snapshot package.
type fakeSpillable struct {
	rows       []string
	restored   []string
	reconciled bool
}

func (f *fakeSpillable) SpillTo(path string) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()
	return gob.NewEncoder(file).Encode(f.rows)
}

func (f *fakeSpillable) RestoreFrom(path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	return gob.NewDecoder(file).Decode(&f.restored)
}

func (f *fakeSpillable) Reconcile() { f.reconciled = true }

// TestRegistryMaintainedStoresSpillRestoreReconcile proves the registry collects maintained
// stores, spills each to a per-name file, restores each (skipping a store with no spill
// file, e.g. a never-spilled/new domain), and reconciles each.
func TestRegistryMaintainedStoresSpillRestoreReconcile(t *testing.T) {
	reg := New()
	a := &fakeSpillable{rows: []string{"a1", "a2"}}
	b := &fakeSpillable{rows: []string{"b1"}}
	reg.RegisterMaintainedStore("dom-a", a)
	reg.RegisterMaintainedStore("dom-b", b)

	dir := t.TempDir()
	require.NoError(t, reg.SpillMaintainedStores(dir))
	require.FileExists(t, filepath.Join(dir, "dom-a.spill"))
	require.FileExists(t, filepath.Join(dir, "dom-b.spill"))

	// A fresh registry + stores (a re-warm): restore from disk. dom-c has no spill file and
	// must be skipped without error (a domain that was never spilled / newly added).
	reg2 := New()
	a2 := &fakeSpillable{}
	b2 := &fakeSpillable{}
	c2 := &fakeSpillable{}
	reg2.RegisterMaintainedStore("dom-a", a2)
	reg2.RegisterMaintainedStore("dom-b", b2)
	reg2.RegisterMaintainedStore("dom-c", c2)

	require.NoError(t, reg2.RestoreMaintainedStores(dir))
	require.Equal(t, []string{"a1", "a2"}, a2.restored)
	require.Equal(t, []string{"b1"}, b2.restored)
	require.Nil(t, c2.restored, "a store with no spill file is skipped, not errored")

	reg2.ReconcileMaintainedStores()
	require.True(t, a2.reconciled)
	require.True(t, b2.reconciled)
	require.True(t, c2.reconciled, "reconcile runs even for a store with no spill file")
}

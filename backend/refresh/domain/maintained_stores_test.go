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

	// swapPath records the file SwapToMmap was asked to write; swapErr forces a cooling
	// failure to exercise the registry's safe-degrade cleanup; closed counts closer calls.
	swapPath string
	swapErr  error
	closed   int
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

func (f *fakeSpillable) SwapToMmap(path string) (func() error, error) {
	if f.swapErr != nil {
		return nil, f.swapErr
	}
	f.swapPath = path
	return func() error { f.closed++; return nil }, nil
}

// TestRegistryCoolMaintainedStoresToMmap proves CoolMaintainedStoresToMmap swaps every
// registered store to a per-domain mmap file and returns one closer per store.
func TestRegistryCoolMaintainedStoresToMmap(t *testing.T) {
	reg := New()
	a := &fakeSpillable{rows: []string{"a1"}}
	b := &fakeSpillable{rows: []string{"b1"}}
	reg.RegisterMaintainedStore("dom-a", a)
	reg.RegisterMaintainedStore("dom-b", b)

	dir := t.TempDir()
	closers, err := reg.CoolMaintainedStoresToMmap(dir)
	require.NoError(t, err)
	require.Len(t, closers, 2, "one closer per maintained store")
	require.Equal(t, filepath.Join(dir, "dom-a.qcm"), a.swapPath)
	require.Equal(t, filepath.Join(dir, "dom-b.qcm"), b.swapPath)

	for _, c := range closers {
		require.NoError(t, c())
	}
	require.Equal(t, 1, a.closed)
	require.Equal(t, 1, b.closed)
}

// TestRegistryCoolMaintainedStoresToMmapErrorClosesOpened proves safe-degrade: if any store
// fails to swap, the registry closes every mapping it already opened and returns the error
// with NO closers, so the caller can fall back to a full teardown with nothing left mapped.
func TestRegistryCoolMaintainedStoresToMmapErrorClosesOpened(t *testing.T) {
	reg := New()
	// dom-a swaps first (sorted order), dom-z fails — dom-a's mapping must be closed.
	a := &fakeSpillable{rows: []string{"a1"}}
	z := &fakeSpillable{swapErr: errBoom}
	reg.RegisterMaintainedStore("dom-a", a)
	reg.RegisterMaintainedStore("dom-z", z)

	closers, err := reg.CoolMaintainedStoresToMmap(t.TempDir())
	require.ErrorIs(t, err, errBoom)
	require.Nil(t, closers, "no closers returned on a failed cool")
	require.Equal(t, 1, a.closed, "the already-opened mapping is closed on cool failure")
}

var errBoom = errBoomType("boom")

type errBoomType string

func (e errBoomType) Error() string { return string(e) }

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

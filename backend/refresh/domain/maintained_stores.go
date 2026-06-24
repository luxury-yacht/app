package domain

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
)

// SpillableStore is a maintained query store the governor can flush to disk when a cluster
// goes Cold (to reclaim heap) and re-paint + reconcile when it re-warms. The snapshot
// package's *typedMaintainedStore implements it; the interface lives here so the registry
// can hold every domain's store type-erased without importing snapshot (which would cycle).
//
//   - SpillTo writes the store's rows to path.
//   - RestoreFrom loads spilled rows from path INTO the existing store (warm-paint); the
//     rows may be stale.
//   - Reconcile diff-syncs the store against its live sources after re-warm sync, dropping
//     rows whose objects were deleted while the cluster was Cold (a no-op for stores whose
//     feed already reconciles on relist).
type SpillableStore interface {
	SpillTo(path string) error
	RestoreFrom(path string) error
	Reconcile()
}

// maintainedStoreSet collects a registry's spillable stores keyed by a stable,
// filesystem-safe name (the domain name), guarded independently of the domain map so a
// reconcile/spill never blocks Build. Initialised lazily so a Registry built without New()
// (test fixtures) never nil-maps.
type maintainedStoreSet struct {
	mu     sync.Mutex
	stores map[string]SpillableStore
}

// RegisterMaintainedStore records a domain's maintained store under name so the governor
// can spill/restore/reconcile it across Cold/re-warm. name must be filesystem-safe and
// stable across runs (the domain name) — it is the spill file's basename. A duplicate name
// overwrites (a domain registers exactly one maintained store).
func (r *Registry) RegisterMaintainedStore(name string, store SpillableStore) {
	if name == "" || store == nil {
		return
	}
	r.maintained.mu.Lock()
	defer r.maintained.mu.Unlock()
	if r.maintained.stores == nil {
		r.maintained.stores = make(map[string]SpillableStore)
	}
	r.maintained.stores[name] = store
}

// maintainedSnapshot returns the registered stores as a name+store list, sorted by name for
// deterministic iteration, taken under the lock so iteration never races registration.
func (r *Registry) maintainedSnapshot() []namedSpillable {
	r.maintained.mu.Lock()
	defer r.maintained.mu.Unlock()
	out := make([]namedSpillable, 0, len(r.maintained.stores))
	for name, store := range r.maintained.stores {
		out = append(out, namedSpillable{name: name, store: store})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].name < out[j].name })
	return out
}

type namedSpillable struct {
	name  string
	store SpillableStore
}

// spillFileName derives a store's spill-file path under dir from its name.
func spillFileName(dir, name string) string {
	return filepath.Join(dir, name+".spill")
}

// SpillMaintainedStores flushes every registered store to dir (one file per store named
// <store>.spill), creating dir if needed. It is what the governor's Cold action calls
// before reclaiming the cluster's heap. Errors from individual stores are joined so one
// bad store does not silently skip the rest.
func (r *Registry) SpillMaintainedStores(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("domain: spill mkdir %q: %w", dir, err)
	}
	var errs []error
	for _, ns := range r.maintainedSnapshot() {
		if err := ns.store.SpillTo(spillFileName(dir, ns.name)); err != nil {
			errs = append(errs, fmt.Errorf("spill %q: %w", ns.name, err))
		}
	}
	return errors.Join(errs...)
}

// RestoreMaintainedStores loads each registered store's rows from its file under dir, for
// warm-paint on re-warm. A store with no spill file is skipped (never spilled, or a newly
// added domain) — the normal cold-start case, not an error. Other errors are joined.
// Restored rows may be stale; ReconcileMaintainedStores reconciles them after the fresh
// sync.
func (r *Registry) RestoreMaintainedStores(dir string) error {
	var errs []error
	for _, ns := range r.maintainedSnapshot() {
		path := spillFileName(dir, ns.name)
		if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err := ns.store.RestoreFrom(path); err != nil {
			errs = append(errs, fmt.Errorf("restore %q: %w", ns.name, err))
		}
	}
	return errors.Join(errs...)
}

// ReconcileMaintainedStores reconciles every registered store against its live sources —
// the re-warm step that drops rows warm-painted from a stale spill for objects deleted
// while the cluster was Cold. It must run AFTER the fresh subsystem has synced. Stores
// whose feed already reconciles on relist treat it as a no-op.
func (r *Registry) ReconcileMaintainedStores() {
	for _, ns := range r.maintainedSnapshot() {
		ns.store.Reconcile()
	}
}

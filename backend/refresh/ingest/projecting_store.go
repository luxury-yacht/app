// Package ingest implements an owned-reflector columnar ingestion path: a
// cache.Store that projects each Kubernetes object to a row at intake and keeps
// ONLY the projection, fed by a reflector that borrows client-go's List/Watch/
// relist machinery.
//
// Today client-go's typed informers cache the full typed object (*corev1.Pod,
// …) while the maintained stores additionally hold projected rows — double
// storage. ProjectingStore collapses that: the source object is projected the
// moment it lands and is then droppable, so the store holds the projected row
// alone. This package is self-contained and is NOT wired into any live path; it
// is the foundation later steps cut consumers over to.
package ingest

import (
	"sync"

	"k8s.io/client-go/tools/cache"
	"k8s.io/klog/v2"
)

// ProjectFunc maps a Kubernetes object to its projected row (any type). It is
// injected so the store stays generic — there is no per-kind logic here; the
// caller supplies the projection for the kind it ingests.
type ProjectFunc func(obj interface{}) (interface{}, error)

// ProjectingStore is a cache.Store that holds the PROJECTED row per object
// instead of the full source object. On Add/Update/Replace it runs the injected
// projection and stores only the result keyed by cache.MetaNamespaceKeyFunc; the
// source typed object is never retained. It is safe for concurrent use: a
// reflector mutates it from its watch goroutine while readers list it.
type ProjectingStore struct {
	project ProjectFunc

	mu   sync.RWMutex
	rows map[string]interface{}

	// rv is the latest resource version the store has observed, recorded by
	// Replace (relist) and Bookmark (watch bookmark) and returned by
	// LastStoreSyncResourceVersion — the reflector's relist/resume bookkeeping.
	rv string

	// synced flips true the first time Replace runs — i.e. when the reflector's
	// initial relist has landed — and stays true. The ingest manager gates
	// readiness on it (HasSynced), mirroring a SharedInformer's HasSynced.
	synced bool

	// projectErrLogged ensures a recurring projection failure is logged once,
	// matching the repo rule that recurring identical errors log exactly once.
	projectErrLogged bool
}

var _ cache.Store = (*ProjectingStore)(nil)

// NewProjectingStore returns a store that projects each object via project and
// retains only the projected row.
func NewProjectingStore(project ProjectFunc) *ProjectingStore {
	return &ProjectingStore{
		project: project,
		rows:    make(map[string]interface{}),
	}
}

// keyOf resolves an object's store key, unwrapping a delete tombstone first so a
// DeletedFinalStateUnknown keys to the same string its live object did.
func keyOf(obj interface{}) (string, error) {
	if tombstone, ok := obj.(cache.DeletedFinalStateUnknown); ok {
		return tombstone.Key, nil
	}
	return cache.MetaNamespaceKeyFunc(obj)
}

// projectAndStore keys the object, projects it, and stores ONLY the projected
// row. A projection error is logged once and the object skipped (it is never
// stored and the error is not propagated), so one bad object cannot fail a whole
// Add/Update/Replace. It assumes the caller holds the write lock.
func (s *ProjectingStore) projectAndStore(obj interface{}) error {
	key, err := keyOf(obj)
	if err != nil {
		return cache.KeyError{Obj: obj, Err: err}
	}
	projected, err := s.project(obj)
	if err != nil {
		if !s.projectErrLogged {
			s.projectErrLogged = true
			klog.V(2).Infof("ingest: projection failed for %q, skipping (logged once): %v", key, err)
		}
		return nil
	}
	s.rows[key] = projected
	return nil
}

// Add projects obj and stores the projected row under its key. The source
// object is not retained.
func (s *ProjectingStore) Add(obj interface{}) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.projectAndStore(obj)
}

// Update re-projects obj and replaces the projected row under its key. The
// source object is not retained.
func (s *ProjectingStore) Update(obj interface{}) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.projectAndStore(obj)
}

// Delete removes the projected row for obj's key, unwrapping a
// DeletedFinalStateUnknown tombstone so a missed delete still evicts the row.
func (s *ProjectingStore) Delete(obj interface{}) error {
	key, err := keyOf(obj)
	if err != nil {
		return cache.KeyError{Obj: obj, Err: err}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.rows, key)
	return nil
}

// List returns a snapshot slice of the projected rows. The elements are the
// projections, never source objects.
func (s *ProjectingStore) List() []interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]interface{}, 0, len(s.rows))
	for _, row := range s.rows {
		out = append(out, row)
	}
	return out
}

// ListKeys returns a snapshot slice of the keys currently associated with a
// projected row.
func (s *ProjectingStore) ListKeys() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]string, 0, len(s.rows))
	for key := range s.rows {
		out = append(out, key)
	}
	return out
}

// Get returns the projected row for obj's key.
func (s *ProjectingStore) Get(obj interface{}) (item interface{}, exists bool, err error) {
	key, err := keyOf(obj)
	if err != nil {
		return nil, false, cache.KeyError{Obj: obj, Err: err}
	}
	return s.GetByKey(key)
}

// GetByKey returns the projected row stored under key.
func (s *ProjectingStore) GetByKey(key string) (item interface{}, exists bool, err error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	item, exists = s.rows[key]
	return item, exists, nil
}

// Replace atomically re-projects the whole supplied set, dropping every key not
// present in it. This is the relist path: the new list fully defines the store.
// A projection error on one object is logged once and that object skipped — the
// rest of the set is still installed. resourceVersion is the relist RV the
// reflector resumes its watch from; it is recorded for
// LastStoreSyncResourceVersion.
func (s *ProjectingStore) Replace(list []interface{}, resourceVersion string) error {
	next := make(map[string]interface{}, len(list))
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, obj := range list {
		key, err := keyOf(obj)
		if err != nil {
			return cache.KeyError{Obj: obj, Err: err}
		}
		projected, err := s.project(obj)
		if err != nil {
			if !s.projectErrLogged {
				s.projectErrLogged = true
				klog.V(2).Infof("ingest: projection failed for %q during replace, skipping (logged once): %v", key, err)
			}
			continue
		}
		next[key] = projected
	}
	s.rows = next
	s.rv = resourceVersion
	s.synced = true
	return nil
}

// HasSynced reports whether the reflector's initial relist has landed: it is
// false until the first Replace and true forever after. The ingest manager
// waits on it to know a kind's store is populated, exactly as a SharedInformer's
// HasSynced gates readiness.
func (s *ProjectingStore) HasSynced() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.synced
}

// Resync is a no-op: the projected rows are already current and there is no
// secondary index to rebuild.
func (s *ProjectingStore) Resync() error {
	return nil
}

// LastStoreSyncResourceVersion returns the latest resource version the store has
// observed, used by the reflector to determine where to resume after a relist.
func (s *ProjectingStore) LastStoreSyncResourceVersion() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.rv
}

// Bookmark records a resource version observed from a watch bookmark event, so
// LastStoreSyncResourceVersion advances without a relist.
func (s *ProjectingStore) Bookmark(rv string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rv = rv
}

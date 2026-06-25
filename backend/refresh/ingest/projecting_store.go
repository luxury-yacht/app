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
	"bufio"
	"encoding/gob"
	"fmt"
	"os"
	"sync"

	"k8s.io/client-go/tools/cache"
	"k8s.io/klog/v2"
)

// spilledBundles is the on-disk form of a ProjectingStore: the projected Bundle per object
// key plus the resourceVersion the store had observed, so a restart can restore the full
// projected state and resume the watch from RV instead of a full re-LIST (Tier 2.5 stage 3).
type spilledBundles struct {
	Rows map[string]Bundle
	RV   string
}

// ProjectFunc maps a Kubernetes object to its projected row (any type). It is
// injected so the store stays generic — there is no per-kind logic here; the
// caller supplies the projection for the kind it ingests.
type ProjectFunc func(obj interface{}) (interface{}, error)

// Bundle is the per-object projection a kind ingested for multiple consumers
// holds: the Table half is the directly-streamed/summary-table row (the kind's
// StreamRow output), the Catalog half is the object-catalog Summary, and the
// ObjectMap half is the object-map graph node (the kind's collector status +
// action facts + pre-resolved edges). Any half may be nil when the kind has no
// projector for that consumer. The store keeps the bundle, never the source
// object, so every consumer reads its half from one ingestion.
type Bundle struct {
	Table     interface{}
	Catalog   interface{}
	ObjectMap interface{}
	// Aggregate is an optional fourth half: a small reduced row a kind's bespoke
	// aggregation consumers read (the pod kind's PodAggregate, consumed by the
	// cluster-overview/nodes/namespace-workloads domains). It is nil for every kind
	// except pods, exactly as ObjectMap is nil for kinds with no graph node.
	Aggregate interface{}
}

// Sink receives a kind's Table-half row incrementally as the reflector mutates
// the store: Upsert on Add/Update/Replace, Delete on eviction. Both halves carry
// the Table-half row (never the source object), so the sink derives its own key
// from the row and need not share the store's cache keyspace. A maintained store
// registers as a Sink so it stays current without polling. Sink calls happen
// while the store holds its write lock, so a Sink implementation must not call
// back into the store.
type Sink interface {
	Upsert(tableRow interface{})
	Delete(tableRow interface{})
}

// BundleSink receives the WHOLE projected Bundle (every half together) as the store
// mutates: UpsertBundle on Add/Update/Replace, DeleteBundle on eviction. It exists for a
// consumer that needs more than one half of the SAME object in one delivery — the pod
// live-stream notify needs the Table half (Node/owner for the broadcast scope) and the
// Catalog half (UID/resourceVersion for the change Ref) of the same pod, which separate
// Table/Catalog sinks cannot guarantee across a concurrent mutation. Like Sink, calls
// happen under the store's write lock, so an implementation must not call back in.
type BundleSink interface {
	UpsertBundle(bundle Bundle)
	DeleteBundle(bundle Bundle)
}

// ProjectingStore is a cache.Store that holds the PROJECTED row per object
// instead of the full source object. On Add/Update/Replace it runs the injected
// projection and stores only the result keyed by cache.MetaNamespaceKeyFunc; the
// source typed object is never retained. It is safe for concurrent use: a
// reflector mutates it from its watch goroutine while readers list it.
type ProjectingStore struct {
	project ProjectFunc

	mu   sync.RWMutex
	rows map[string]interface{}

	// sinks receive each row's Table half incrementally as the store mutates
	// (Upsert on store, Delete on eviction), so consumers — a maintained store, a
	// response-cache invalidator — stay current without polling. They are read
	// under the store's lock, so AddSink must be called before the reflector
	// starts. Multiple sinks let several consumers observe one ingestion.
	sinks []Sink

	// catalogSinks receive each row's Catalog half incrementally, on the same
	// Upsert/Delete events, so the object catalog stays current for an ingest-owned
	// kind without reading the (now-absent) shared informer. They are registered and
	// fanned exactly like sinks, but carry the Catalog half rather than the Table half.
	catalogSinks []Sink

	// bundleSinks receive the WHOLE projected Bundle on the same Upsert/Delete events,
	// so a consumer needing more than one half of the same object (the pod live-stream
	// notify) gets both halves in one delivery. Non-Bundle projections are not fanned to
	// them (the value is not a Bundle).
	bundleSinks []BundleSink

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

// AddSink registers a Sink fed each row's Table half incrementally. It must be
// called before the reflector starts so no mutation is missed. Multiple sinks may
// be registered; each receives every Upsert/Delete. A nil sink is ignored.
func (s *ProjectingStore) AddSink(sink Sink) {
	if sink == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sinks = append(s.sinks, sink)
}

// AddCatalogSink registers a Sink fed each row's Catalog half incrementally, on the
// same Upsert/Delete events as AddSink, and immediately replays the Catalog half of
// every row already in the store to the new sink as an Upsert. The replay mirrors a
// SharedIndexInformer's AddEventHandler, which re-delivers the current store to a
// handler added after the informer synced — so the catalog may register its sink
// AFTER the reflector started (the production order, since the catalog Service is
// built after the ingest manager) without missing the already-ingested set. A nil
// sink is ignored.
func (s *ProjectingStore) AddCatalogSink(sink Sink) {
	if sink == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.catalogSinks = append(s.catalogSinks, sink)
	for _, row := range s.rows {
		if cat := catalogHalf(row); cat != nil {
			sink.Upsert(cat)
		}
	}
}

// AddBundleSink registers a BundleSink fed the whole projected Bundle on each
// Upsert/Delete. It must be called before the reflector starts so no mutation is missed.
// A nil sink is ignored.
func (s *ProjectingStore) AddBundleSink(sink BundleSink) {
	if sink == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.bundleSinks = append(s.bundleSinks, sink)
}

// hasSinks reports whether any Table-half, Catalog-half, or whole-bundle sink is
// registered, so the mutation paths can skip extraction work when nothing observes them.
func (s *ProjectingStore) hasSinks() bool {
	return len(s.sinks) > 0 || len(s.catalogSinks) > 0 || len(s.bundleSinks) > 0
}

// emitUpsert / emitDelete fan a projected value's Table half out to every Table sink
// and its Catalog half out to every Catalog sink, each only when that half is
// non-nil. They assume the caller holds the write lock; a sink must not call back
// into the store.
func (s *ProjectingStore) emitUpsert(projected interface{}) {
	if len(s.sinks) > 0 {
		if table := tableHalf(projected); table != nil {
			for _, sink := range s.sinks {
				sink.Upsert(table)
			}
		}
	}
	if len(s.catalogSinks) > 0 {
		if cat := catalogHalf(projected); cat != nil {
			for _, sink := range s.catalogSinks {
				sink.Upsert(cat)
			}
		}
	}
	if len(s.bundleSinks) > 0 {
		if bundle, ok := projected.(Bundle); ok {
			for _, sink := range s.bundleSinks {
				sink.UpsertBundle(bundle)
			}
		}
	}
}

func (s *ProjectingStore) emitDelete(projected interface{}) {
	if len(s.sinks) > 0 {
		if table := tableHalf(projected); table != nil {
			for _, sink := range s.sinks {
				sink.Delete(table)
			}
		}
	}
	if len(s.catalogSinks) > 0 {
		if cat := catalogHalf(projected); cat != nil {
			for _, sink := range s.catalogSinks {
				sink.Delete(cat)
			}
		}
	}
	if len(s.bundleSinks) > 0 {
		if bundle, ok := projected.(Bundle); ok {
			for _, sink := range s.bundleSinks {
				sink.DeleteBundle(bundle)
			}
		}
	}
}

// tableHalf returns the Table half of a projected value: the Table field when the
// value is a Bundle, otherwise the value itself (the table-only projection path,
// where the stored value IS the table row). nil Table yields nil.
func tableHalf(projected interface{}) interface{} {
	if b, ok := projected.(Bundle); ok {
		return b.Table
	}
	return projected
}

// catalogHalf returns the Catalog half of a projected value, or nil when the value
// is not a Bundle or carries no catalog projection.
func catalogHalf(projected interface{}) interface{} {
	if b, ok := projected.(Bundle); ok {
		return b.Catalog
	}
	return nil
}

// objectMapHalf returns the ObjectMap half of a projected value, or nil when the
// value is not a Bundle or carries no object-map projection.
func objectMapHalf(projected interface{}) interface{} {
	if b, ok := projected.(Bundle); ok {
		return b.ObjectMap
	}
	return nil
}

// aggregateHalf returns the Aggregate half of a projected value, or nil when the
// value is not a Bundle or carries no aggregate projection.
func aggregateHalf(projected interface{}) interface{} {
	if b, ok := projected.(Bundle); ok {
		return b.Aggregate
	}
	return nil
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
	if s.hasSinks() {
		s.emitUpsert(projected)
	}
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
	stored, existed := s.rows[key]
	delete(s.rows, key)
	if existed && s.hasSinks() {
		s.emitDelete(stored)
	}
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

// TableRows returns a snapshot slice of the Table half of every stored projection
// (the directly-streamed/summary-table row). Rows whose Table half is nil are
// omitted. For a table-only projection (the stored value is not a Bundle) the
// stored value itself is the table row.
func (s *ProjectingStore) TableRows() []interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]interface{}, 0, len(s.rows))
	for _, row := range s.rows {
		if table := tableHalf(row); table != nil {
			out = append(out, table)
		}
	}
	return out
}

// CatalogRows returns a snapshot slice of the Catalog half of every stored
// projection (the object-catalog Summary). Rows whose Catalog half is nil — kinds
// with no catalog projector — are omitted.
func (s *ProjectingStore) CatalogRows() []interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]interface{}, 0, len(s.rows))
	for _, row := range s.rows {
		if cat := catalogHalf(row); cat != nil {
			out = append(out, cat)
		}
	}
	return out
}

// ObjectMapRows returns a snapshot slice of the ObjectMap half of every stored
// projection (the object-map graph node). Rows whose ObjectMap half is nil — kinds
// with no object-map projector — are omitted.
func (s *ProjectingStore) ObjectMapRows() []interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]interface{}, 0, len(s.rows))
	for _, row := range s.rows {
		if node := objectMapHalf(row); node != nil {
			out = append(out, node)
		}
	}
	return out
}

// AggregateRows returns a snapshot slice of the Aggregate half of every stored
// projection (a kind's bespoke aggregation row — the pod kind's PodAggregate). Rows
// whose Aggregate half is nil — every kind but pods — are omitted.
func (s *ProjectingStore) AggregateRows() []interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]interface{}, 0, len(s.rows))
	for _, row := range s.rows {
		if agg := aggregateHalf(row); agg != nil {
			out = append(out, agg)
		}
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
	prev := s.rows
	s.rows = next
	s.rv = resourceVersion
	s.synced = true
	if s.hasSinks() {
		s.feedSinksReplace(prev, next)
	}
	return nil
}

// feedSinksReplace reconciles a relist against every sink: it deletes every key that
// vanished from the new set, then upserts the whole new set — fanning each projected
// value's Table and Catalog halves to their respective sinks. It assumes the caller
// holds the write lock and at least one sink is registered.
func (s *ProjectingStore) feedSinksReplace(prev, next map[string]interface{}) {
	for key, stored := range prev {
		if _, kept := next[key]; kept {
			continue
		}
		s.emitDelete(stored)
	}
	for _, projected := range next {
		s.emitUpsert(projected)
	}
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

// SpillBundles writes the store's projected Bundles (keyed by object) plus its observed
// resourceVersion to path, so a restart can restore the full projected state and resume the
// watch from that RV (stage 3). Only Bundle-valued rows are written (every ingest projection
// is a Bundle). It gob-encodes through the Bundle's interface halves, so every concrete
// projected type must be gob-registered; an encode error (an unregistered type) is returned
// so the caller skips this kind and lets its reflector full-sync instead — never a regression.
func (s *ProjectingStore) SpillBundles(path string) error {
	s.mu.RLock()
	snap := spilledBundles{Rows: make(map[string]Bundle, len(s.rows)), RV: s.rv}
	for key, row := range s.rows {
		if b, ok := row.(Bundle); ok {
			snap.Rows[key] = b
		}
	}
	s.mu.RUnlock()

	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("ingest: spill create %q: %w", path, err)
	}
	defer f.Close()
	bw := bufio.NewWriter(f)
	if err := gob.NewEncoder(bw).Encode(snap); err != nil {
		return fmt.Errorf("ingest: spill encode %q: %w", path, err)
	}
	if err := bw.Flush(); err != nil {
		return fmt.Errorf("ingest: spill flush %q: %w", path, err)
	}
	return f.Close()
}

// RestoreBundles loads spilled Bundles from path DIRECTLY into the store (they are already
// projected — the source object is gone, so they are not re-projected), sets the observed
// resourceVersion, and marks the store synced (the restored state is the baseline a delta
// resume builds on). It returns the RV so the caller can resume the watch from it
// (SetResumeResourceVersion). A missing/corrupt file or a decode error (an unregistered type)
// returns an error so the caller skips → full sync; the store is left untouched on failure.
func (s *ProjectingStore) RestoreBundles(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("ingest: restore open %q: %w", path, err)
	}
	defer f.Close()
	var snap spilledBundles
	if err := gob.NewDecoder(bufio.NewReader(f)).Decode(&snap); err != nil {
		return "", fmt.Errorf("ingest: restore decode %q: %w", path, err)
	}

	s.mu.Lock()
	s.rows = make(map[string]interface{}, len(snap.Rows))
	for key, b := range snap.Rows {
		s.rows[key] = b
	}
	s.rv = snap.RV
	s.synced = true
	s.mu.Unlock()
	return snap.RV, nil
}

// MarkSynced flips the store's synced flag without a Replace, for the stage-3 resume path:
// when the store's baseline came from a restored spill (not a relist) and a delta watch keeps
// it current, the store is serveable and ready even though Replace never ran. It only ever
// turns synced on (readiness latches), mirroring Replace's synced=true.
func (s *ProjectingStore) MarkSynced() {
	s.mu.Lock()
	s.synced = true
	s.mu.Unlock()
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

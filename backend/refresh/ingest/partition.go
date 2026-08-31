package ingest

import (
	"strings"
	"sync"

	"k8s.io/client-go/tools/cache"
	"k8s.io/klog/v2"
)

// Namespace-partitioned ingestion (docs/architecture/namespace-scope.md): a scoped
// cluster runs one reflector per configured namespace against ONE shared
// ProjectingStore. Each reflector writes through a partition view, so
// client-go's "Replace fully defines the store" contract holds per
// PARTITION: a relist in one namespace drops only that namespace's vanished
// keys and can never wipe sibling namespaces' rows (the multi-kind unscoped
// BundleSink wipe class, one level deeper). The unscoped path is the same
// code with a single "" partition, which degenerates to the classic
// full-store Replace — one code path, scope as a value.

// SetExpectedPartitions declares the namespaces whose reflectors feed this
// store. Once set, HasSynced reports true only when EVERY expected partition
// has completed its initial relist (or was marked synced by a resume) — the
// per-partition equivalent of "the initial relist landed". Call before the
// reflectors start. Unset (nil) keeps the classic single-source behavior.
func (s *ProjectingStore) SetExpectedPartitions(namespaces []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.expectedPartitions = append([]string(nil), namespaces...)
	if s.syncedPartitions == nil {
		s.syncedPartitions = make(map[string]struct{}, len(namespaces))
	}
}

// HasSyncedPartition reports whether one reflector's initial snapshot has
// landed. The bounded startup queue uses this narrower signal so a completed
// namespace can release its slot before sibling partitions finish.
func (s *ProjectingStore) HasSyncedPartition(namespace string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.syncedPartitions[namespace]
	return ok
}

// PartitionView returns the cache.Store a single namespace's reflector writes
// through. namespace "" is the cluster-wide view (classic Replace semantics).
func (s *ProjectingStore) PartitionView(namespace string) *StorePartitionView {
	return &StorePartitionView{store: s, namespace: namespace}
}

// ReplacePartition is Replace scoped to one namespace partition: the supplied
// list fully defines that namespace's rows; every other namespace's rows are
// untouched. Sinks receive the partition's vanished keys as deletes and its
// new set as per-row upserts — never a bulk kind-wide Replace, because the
// bulk sink contract ("full state for the kind") would make the consumer drop
// sibling namespaces' rows. namespace "" delegates to the classic Replace.
func (s *ProjectingStore) ReplacePartition(namespace string, list []interface{}, resourceVersion string) error {
	if namespace == "" {
		return s.replaceUnpartitioned(list, resourceVersion)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	next, err := s.projectPartitionRows(list)
	if err != nil {
		return err
	}
	prefix := namespace + "/"
	s.emitPartitionChanges(prefix, next)
	s.replacePartitionRows(prefix, next)
	s.recordPartitionVersion(namespace, resourceVersion)
	s.rebuildIndexesLocked()
	return nil
}

func (s *ProjectingStore) replaceUnpartitioned(list []interface{}, resourceVersion string) error {
	if err := s.Replace(list, resourceVersion); err != nil {
		return err
	}
	s.mu.Lock()
	s.markPartitionSyncedLocked("")
	s.mu.Unlock()
	return nil
}

func (s *ProjectingStore) projectPartitionRows(list []interface{}) (map[string]interface{}, error) {
	next := make(map[string]interface{}, len(list))
	for _, obj := range list {
		key, err := keyOf(obj)
		if err != nil {
			return nil, cache.KeyError{Obj: obj, Err: err}
		}
		projected, err := s.project(obj)
		if err != nil {
			if !s.projectErrLogged {
				s.projectErrLogged = true
				klog.V(2).Infof("ingest: projection failed for %q during partition replace, skipping (logged once): %v", key, err)
			}
			continue
		}
		next[key] = projected
	}
	return next, nil
}

func (s *ProjectingStore) emitPartitionChanges(prefix string, next map[string]interface{}) {
	if !s.hasSinks() {
		return
	}
	// Deletes first (vanished keys fan the PREVIOUS stored bundle, whose
	// Catalog half is retained, so catalog-keyed consumers evict ghosts),
	// then per-row upserts — feedSinksReplace minus the bulk path.
	for key, stored := range s.rows {
		if strings.HasPrefix(key, prefix) {
			if _, kept := next[key]; !kept {
				s.emitDelete(stored)
			}
		}
	}
	for _, projected := range next {
		s.emitUpsert(projected)
	}
}

func (s *ProjectingStore) replacePartitionRows(prefix string, next map[string]interface{}) {
	for key := range s.rows {
		if strings.HasPrefix(key, prefix) {
			delete(s.rows, key)
		}
	}
	for key, projected := range next {
		s.rows[key] = s.storedValue(projected)
	}
}

func (s *ProjectingStore) recordPartitionVersion(namespace, resourceVersion string) {
	if s.partitionRVs == nil {
		s.partitionRVs = make(map[string]string)
	}
	s.partitionRVs[namespace] = resourceVersion
	s.rv = resourceVersion
	s.markPartitionSyncedLocked(namespace)
}

// MarkPartitionSynced is MarkSynced for one partition — the stage-3 resume
// path of a scoped reflector whose baseline came from a restored spill.
func (s *ProjectingStore) MarkPartitionSynced(namespace string) {
	s.mu.Lock()
	s.markPartitionSyncedLocked(namespace)
	s.mu.Unlock()
}

// markPartitionSyncedLocked records the partition's initial sync and, once
// every expected partition has landed, latches the store-level synced flag
// (stamping syncedAt exactly once). Callers hold the write lock.
func (s *ProjectingStore) markPartitionSyncedLocked(namespace string) {
	if s.syncedPartitions == nil {
		s.syncedPartitions = make(map[string]struct{})
	}
	s.syncedPartitions[namespace] = struct{}{}
	if len(s.expectedPartitions) == 0 {
		// No declared partitions: store-level sync is owned by the classic
		// Replace/MarkSynced path.
		return
	}
	for _, expected := range s.expectedPartitions {
		if _, ok := s.syncedPartitions[expected]; !ok {
			return
		}
	}
	s.markSyncedLocked()
}

// BookmarkPartition records a watch bookmark for one partition's resume
// bookkeeping (and advances the store-level RV like Bookmark).
func (s *ProjectingStore) BookmarkPartition(namespace, rv string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.partitionRVs == nil {
		s.partitionRVs = make(map[string]string)
	}
	s.partitionRVs[namespace] = rv
	s.rv = rv
}

// PartitionResourceVersions returns the latest per-partition resource
// versions (spill/resume bookkeeping for scoped reflectors).
func (s *ProjectingStore) PartitionResourceVersions() map[string]string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string]string, len(s.partitionRVs))
	for ns, rv := range s.partitionRVs {
		out[ns] = rv
	}
	return out
}

// StorePartitionView is the cache.Store one scoped reflector writes through:
// per-object mutations pass straight to the shared store; Replace, MarkSynced,
// and Bookmark are scoped to the view's namespace partition.
type StorePartitionView struct {
	store               *ProjectingStore
	namespace           string
	initialSyncOnce     sync.Once
	initialSyncObserver func()
}

var _ cache.Store = (*StorePartitionView)(nil)

func (v *StorePartitionView) Add(obj interface{}) error    { return v.store.Add(obj) }
func (v *StorePartitionView) Update(obj interface{}) error { return v.store.Update(obj) }
func (v *StorePartitionView) Delete(obj interface{}) error { return v.store.Delete(obj) }
func (v *StorePartitionView) List() []interface{}          { return v.store.List() }
func (v *StorePartitionView) ListKeys() []string           { return v.store.ListKeys() }
func (v *StorePartitionView) Get(obj interface{}) (interface{}, bool, error) {
	return v.store.Get(obj)
}
func (v *StorePartitionView) GetByKey(key string) (interface{}, bool, error) {
	return v.store.GetByKey(key)
}
func (v *StorePartitionView) Resync() error { return v.store.Resync() }

func (v *StorePartitionView) Replace(list []interface{}, resourceVersion string) error {
	if err := v.store.ReplacePartition(v.namespace, list, resourceVersion); err != nil {
		return err
	}
	v.notifyInitialSync()
	return nil
}

func (v *StorePartitionView) MarkSynced() {
	v.store.MarkPartitionSynced(v.namespace)
	v.notifyInitialSync()
}

func (v *StorePartitionView) Bookmark(rv string) {
	v.store.BookmarkPartition(v.namespace, rv)
}

// LastStoreSyncResourceVersion reports the view's partition RV so a reflector
// relist resumes from ITS namespace's version, not a sibling's.
func (v *StorePartitionView) LastStoreSyncResourceVersion() string {
	v.store.mu.RLock()
	defer v.store.mu.RUnlock()
	return v.store.partitionRVs[v.namespace]
}

// setInitialSyncObserver installs the startup timing callback before this
// partition's reflector launches. sync.Once keeps later relists from reporting
// duplicate initial-sync recovery events.
func (v *StorePartitionView) setInitialSyncObserver(observer func()) {
	v.initialSyncObserver = observer
}

func (v *StorePartitionView) notifyInitialSync() {
	if v.initialSyncObserver == nil {
		return
	}
	v.initialSyncOnce.Do(v.initialSyncObserver)
}

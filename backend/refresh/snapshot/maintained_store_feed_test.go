package snapshot

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/kind/streamspec"
)

// Test helpers that apply one object to a maintained store directly through
// its descriptor's StreamRow projection, without a sink or doorbell. Production
// stores are fed only by ingest sinks.

// ingest projects an added/updated object via the descriptor's StreamRow closure
// and upserts it — generic over the domain's kinds, no per-kind branch.
func (m *typedMaintainedStore[T]) ingest(d streamspec.Descriptor, obj interface{}) {
	item, ok := unwrapTombstone(obj).(metav1.Object)
	if !ok {
		return
	}
	row, ok := d.StreamRow(m.meta, item).(T)
	if !ok {
		return
	}
	m.store.Upsert(row)
	m.bumpVersion(item)
}

// evict removes a deleted object by its row key. It projects the object via the
// descriptor's StreamRow closure and derives the key through the adapter's own Key
// function — the SAME key Upsert stored it under — so namespaced and cluster-scoped
// domains (which key rows differently) both delete correctly, with no per-kind branch.
func (m *typedMaintainedStore[T]) evict(d streamspec.Descriptor, obj interface{}) {
	item, ok := unwrapTombstone(obj).(metav1.Object)
	if !ok {
		return
	}
	row, ok := d.StreamRow(m.meta, item).(T)
	if !ok {
		return
	}
	m.store.Delete(m.adapter.Key(row))
}

// upsertRow upserts an already-projected row and raises the version from its
// source object, the way the list path versions the same rows.
func (m *typedMaintainedStore[T]) upsertRow(row T, o metav1.Object) {
	m.store.Upsert(row)
	m.bumpVersion(o)
}

// bumpVersion raises the store version to the object's resourceVersion, so a
// test store directly fed rows reports the version its list path does.
func (m *typedMaintainedStore[T]) bumpVersion(o metav1.Object) {
	v := resourceVersionOrTimestamp(o)
	m.mu.Lock()
	if v > m.version {
		m.version = v
	}
	m.mu.Unlock()
}

// unwrapTombstone resolves a cache.DeletedFinalStateUnknown to its object, as a
// reflector delivers a delete it missed.
func unwrapTombstone(obj interface{}) interface{} {
	if tombstone, ok := obj.(cache.DeletedFinalStateUnknown); ok {
		return tombstone.Obj
	}
	return obj
}

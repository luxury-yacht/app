package ingest

import (
	"context"
	"time"

	apiruntime "k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/tools/cache"
)

// ProjectingReflector borrows client-go's reflector to drive a ProjectingStore.
// The reflector owns all the List/Watch/relist/resourceVersion/410-Gone
// bookkeeping; this wrapper just owns the store the reflector writes into, so
// objects are projected at intake and the source object is dropped — never
// landing in a typed indexer.
type ProjectingReflector struct {
	reflector *cache.Reflector
	store     *ProjectingStore
}

// NewProjectingReflector wraps cache.NewNamedReflector over lw, feeding the
// supplied ProjectingStore. exampleObject is the expected element type (e.g.
// &corev1.ConfigMap{}); resync is the relist period (0 disables periodic
// resync). It stays thin: no event handling or projection lives here — the
// store performs the projection on every Add/Update/Replace the reflector makes.
func NewProjectingReflector(name string, lw cache.ListerWatcher, exampleObject apiruntime.Object, store *ProjectingStore, resync time.Duration) *ProjectingReflector {
	return &ProjectingReflector{
		reflector: cache.NewNamedReflector(name, lw, exampleObject, store, resync),
		store:     store,
	}
}

// Run drives the reflector until ctx is cancelled. cache.Reflector.Run takes a
// stop channel, so ctx.Done() is passed directly; when ctx is cancelled the
// reflector's List/Watch loop returns and Run unblocks, leaking no goroutine.
func (r *ProjectingReflector) Run(ctx context.Context) {
	r.reflector.Run(ctx.Done())
}

// Store returns the ProjectingStore the reflector feeds. Consumers read the
// projected rows from it; they never see the source objects.
func (r *ProjectingReflector) Store() *ProjectingStore {
	return r.store
}

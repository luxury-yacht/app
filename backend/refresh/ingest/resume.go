package ingest

import (
	"context"

	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	apiruntime "k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/tools/cache"
)

// resume.go is the stage-3 cold-start resume path (Tier 2.5): instead of a full re-LIST, a
// kind whose store was warm-painted from disk (stage 2) resumes its WATCH from the persisted
// resourceVersion and applies only the deltas since. client-go's reflector cannot do this —
// it always transfers full state on initial sync — so the resume is a small custom watch
// loop here, with a 410-Gone fallback to the reflector's full sync (which reconciles, stage 4).
//
// This component is intentionally standalone and not yet wired into IngestManager; a later
// slice spills/restores the ingest stores with their RV and routes the reflector through it.

// resumeOutcome reports how a resume watch ended.
type resumeOutcome int

const (
	// resumeNeedsFullSync means the persisted RV was too old (410-Gone / expired) or the watch
	// could not be sustained, so the caller must fall back to a full sync (which reconciles
	// away anything the stale baseline still holds — stage 4).
	resumeNeedsFullSync resumeOutcome = iota
	// resumeContextDone means the context was cancelled while the resume watch was healthy;
	// the store is current as of the last bookmark.
	resumeContextDone
)

// resumeFromResourceVersion issues a delta WATCH from startRV (SendInitialEvents implicitly
// false — a plain watch streams only changes since startRV) and applies each event to store,
// advancing the store's RV on bookmarks. The store's restored baseline is the state at
// startRV, so once the watch establishes the store is serveable and is marked synced (per-GVR
// readiness). A 410/expired at watch-start, a closed watch, or a watch Error event returns
// resumeNeedsFullSync WITHOUT having relied on the baseline being current; ctx cancellation
// returns resumeContextDone.
func resumeFromResourceVersion(ctx context.Context, lw cache.ListerWatcher, store *ProjectingStore, startRV string) resumeOutcome {
	w, err := cache.ToListerWatcherWithContext(lw).WatchWithContext(ctx, metav1.ListOptions{
		ResourceVersion:     startRV,
		AllowWatchBookmarks: true,
	})
	if err != nil {
		// 410/expired or any other watch-start failure: the baseline cannot be confirmed
		// current, so the caller must full-sync (and reconcile).
		return resumeNeedsFullSync
	}
	defer w.Stop()

	// The restored spill is the state at startRV; the delta watch keeps it current, so the
	// store is serveable now — mark it synced so per-GVR readiness fires without a re-LIST.
	store.MarkSynced()

	for {
		select {
		case <-ctx.Done():
			return resumeContextDone
		case event, ok := <-w.ResultChan():
			if !ok {
				// The watch closed (server hung up / RV aged out mid-stream): full-sync to be safe.
				return resumeNeedsFullSync
			}
			switch event.Type {
			case watch.Added, watch.Modified:
				_ = store.Add(event.Object)
			case watch.Deleted:
				_ = store.Delete(event.Object)
			case watch.Bookmark:
				if rv := resumeResourceVersionOf(event.Object); rv != "" {
					store.Bookmark(rv)
				}
			case watch.Error:
				// The apiserver signalled the watch can no longer continue (typically Gone):
				// fall back to a full sync.
				return resumeNeedsFullSync
			}
		}
	}
}

// runWithResume drives one kind's ingestion: when a persisted resourceVersion is set (and a
// ListerWatcher is available), it first attempts a delta resume from that RV; the resume,
// when healthy, runs as the steady-state watch until ctx ends (no full sync). If there is no
// persisted RV, or the resume reports it needs a full sync (410-Gone / expired / dropped
// watch), it falls back to fullSync — the reflector's full LIST+WATCH, which also reconciles
// anything a stale baseline still held (stage 4). With resumeRV == "" this is exactly the
// reflector's normal launch, so the default (no persisted RV yet) path is unchanged.
func runWithResume(ctx context.Context, lw cache.ListerWatcher, store *ProjectingStore, resumeRV string, fullSync func()) {
	if resumeRV != "" && lw != nil {
		if resumeFromResourceVersion(ctx, lw, store, resumeRV) == resumeContextDone {
			return
		}
	}
	fullSync()
}

// resumeResourceVersionOf reads an object's resourceVersion (a bookmark carries only the RV),
// returning "" when the object exposes no metadata accessor.
func resumeResourceVersionOf(obj apiruntime.Object) string {
	accessor, err := meta.Accessor(obj)
	if err != nil {
		return ""
	}
	return accessor.GetResourceVersion()
}

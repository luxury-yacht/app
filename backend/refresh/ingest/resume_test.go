package ingest

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/tools/cache"
)

func resumeCM(name, rv string) *corev1.ConfigMap {
	return &corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: name, ResourceVersion: rv}}
}

func nameProjectingStore() *ProjectingStore {
	return NewProjectingStore(func(obj interface{}) (interface{}, error) {
		m := obj.(metav1.Object)
		return m.GetName(), nil
	})
}

// TestResumeAppliesDeltasAndMarksSynced proves the stage-3 resume path: a delta WATCH from a
// persisted RV applies Added/Modified/Deleted to the store on top of its restored baseline,
// advances the store RV on a bookmark, and marks the store synced once the watch establishes
// (the warm-painted baseline + live deltas make it serveable → per-GVR readiness).
func TestResumeAppliesDeltasAndMarksSynced(t *testing.T) {
	fw := watch.NewFake()
	lw := &cache.ListWatch{
		WatchFunc: func(metav1.ListOptions) (watch.Interface, error) { return fw, nil },
	}
	store := nameProjectingStore()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan resumeOutcome, 1)
	go func() { done <- resumeFromResourceVersion(ctx, lw, store, "100") }()

	require.Eventually(t, store.HasSynced, time.Second, 5*time.Millisecond,
		"the store is marked synced once the resume watch establishes")

	fw.Add(resumeCM("a", "101"))
	fw.Modify(resumeCM("a", "102"))
	fw.Add(resumeCM("b", "103"))
	fw.Delete(resumeCM("a", "104"))
	fw.Action(watch.Bookmark, resumeCM("", "110"))

	require.Eventually(t, func() bool {
		return len(store.List()) == 1 && store.LastStoreSyncResourceVersion() == "110"
	}, time.Second, 5*time.Millisecond, "deltas applied (a deleted, b present) and RV advanced to the bookmark")

	cancel()
	require.Equal(t, resumeContextDone, <-done)
}

// TestResumeReturnsNeedsFullSyncOn410 proves a too-old persisted RV (the watch start returns
// 410-Gone / expired) makes resume report that the caller must full-sync, and the store is
// NOT marked synced (the baseline can't be trusted current until the full sync reconciles).
func TestResumeReturnsNeedsFullSyncOn410(t *testing.T) {
	lw := &cache.ListWatch{
		WatchFunc: func(metav1.ListOptions) (watch.Interface, error) {
			return nil, apierrors.NewResourceExpired("resourceVersion too old")
		},
	}
	store := nameProjectingStore()

	out := resumeFromResourceVersion(context.Background(), lw, store, "5")
	require.Equal(t, resumeNeedsFullSync, out)
	require.False(t, store.HasSynced(), "a failed resume must not mark the store synced")
}

// TestResumeReturnsNeedsFullSyncOnErrorEvent proves a mid-stream watch Error (e.g. the RV
// expires while watching) also falls back to a full sync.
func TestResumeReturnsNeedsFullSyncOnErrorEvent(t *testing.T) {
	fw := watch.NewFake()
	lw := &cache.ListWatch{
		WatchFunc: func(metav1.ListOptions) (watch.Interface, error) { return fw, nil },
	}
	store := nameProjectingStore()

	done := make(chan resumeOutcome, 1)
	go func() { done <- resumeFromResourceVersion(context.Background(), lw, store, "5") }()

	fw.Error(&metav1.Status{Reason: metav1.StatusReasonGone})
	require.Equal(t, resumeNeedsFullSync, <-done)
}

// TestRunWithResumeHealthyDoesNotFullSync proves the launch wiring: when a persisted RV
// resumes healthily (delta watch live until ctx end), the reflector's full LIST+WATCH is NOT
// run — the resume IS the steady-state.
func TestRunWithResumeHealthyDoesNotFullSync(t *testing.T) {
	fw := watch.NewFake()
	lw := &cache.ListWatch{
		WatchFunc: func(metav1.ListOptions) (watch.Interface, error) { return fw, nil },
	}
	store := nameProjectingStore()

	ctx, cancel := context.WithCancel(context.Background())
	var fullSyncCalled atomic.Bool
	done := make(chan struct{})
	go func() {
		runWithResume(ctx, lw, store, "100", func() { fullSyncCalled.Store(true) })
		close(done)
	}()

	fw.Add(resumeCM("a", "101"))
	require.Eventually(t, func() bool { return len(store.List()) == 1 }, time.Second, 5*time.Millisecond)

	cancel()
	<-done
	require.False(t, fullSyncCalled.Load(), "a healthy resume must not fall back to a full sync")
}

// TestRunWithResume410FallsBackToFullSync proves a too-old RV falls through to the reflector's
// full sync (which reconciles — stage 4).
func TestRunWithResume410FallsBackToFullSync(t *testing.T) {
	lw := &cache.ListWatch{
		WatchFunc: func(metav1.ListOptions) (watch.Interface, error) {
			return nil, apierrors.NewResourceExpired("resourceVersion too old")
		},
	}
	store := nameProjectingStore()

	called := false
	runWithResume(context.Background(), lw, store, "5", func() { called = true })
	require.True(t, called, "a 410 resume must fall back to the full sync")
}

// TestRunWithResumeNoRVFullSyncs proves the default path (no persisted RV — the current
// production state) runs the full sync directly, so every existing reflector is unchanged.
func TestRunWithResumeNoRVFullSyncs(t *testing.T) {
	store := nameProjectingStore()
	called := false
	runWithResume(context.Background(), nil, store, "", func() { called = true })
	require.True(t, called, "with no persisted RV the reflector full-syncs as today")
}

// TestFullSyncFallbackDeletesAbsentUIDs is the stage-4 (410-Gone reconcile-delete) contract:
// when the persisted RV is too old, runWithResume falls back to the reflector's full sync,
// whose LIST → ProjectingStore.Replace drops every warm-painted UID absent from the fresh
// consistent snapshot AND notifies sinks — so a row for an object deleted while the app was
// closed (a zombie row) is killed both in the ingest store and in its downstream maintained
// store / catalog. This is the risk-#7 mitigation.
func TestFullSyncFallbackDeletesAbsentUIDs(t *testing.T) {
	store := nameProjectingStore()
	// Warm-paint: the store holds a and b (the state at the now-too-old RV).
	require.NoError(t, store.Replace([]interface{}{resumeCM("a", "10"), resumeCM("b", "10")}, "10"))
	sink := &recordingSink{}
	store.AddSink(sink) // a downstream maintained store / catalog half

	// The 410 fallback re-LISTs the fresh consistent snapshot: b was deleted while the app
	// was closed, so it is absent. Replace is what the reflector's full sync performs.
	require.NoError(t, store.Replace([]interface{}{resumeCM("a", "20")}, "20"))

	require.Equal(t, 1, len(store.List()), "the zombie row b is dropped from the store")
	require.Len(t, sink.deletes, 1, "the absent UID's delete is propagated to sinks (downstream zombie killed)")
}

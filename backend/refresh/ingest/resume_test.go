package ingest

import (
	"context"
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

package ingest

import (
	"context"
	"testing"
	"time"

	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

// unreachableKube returns a real typed client whose requests never succeed (the host
// refuses connections), so every reflector the ingest manager starts retries its
// initial LIST forever and no store ever syncs. This is the shape of a cut kind the
// user cannot list (RBAC denial) or a hung WatchList — the condition that must NOT
// wedge the whole subsystem's readiness.
func unreachableKube(t *testing.T) kubernetes.Interface {
	t.Helper()
	kube, err := kubernetes.NewForConfig(&rest.Config{Host: "http://127.0.0.1:1"})
	if err != nil {
		t.Fatalf("kubernetes.NewForConfig: %v", err)
	}
	return kube
}

// TestIngestManagerDegradesUnsyncedStoreAfterDeadline pins the readiness contract that
// keeps a single never-syncing cut kind from blocking the whole subsystem: HasSynced()
// must report settled once the sync deadline passes, even though no store ever synced,
// so refresh.Manager.Start stops blocking on waitForIngestSynced (and the metrics
// poller it gates can start). Mirrors the informer factory's stateSettled (issue #225).
func TestIngestManagerDegradesUnsyncedStoreAfterDeadline(t *testing.T) {
	mgr := NewIngestManager(testMeta, unreachableKube(t), nil, nil)
	if len(mgr.entries) == 0 {
		t.Fatal("expected the manager to build at least one reflector entry")
	}
	current := time.Unix(1_700_000_000, 0)
	mgr.now = func() time.Time { return current }
	mgr.syncDeadline = 50 * time.Millisecond

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	mgr.Start(ctx)

	if mgr.HasSynced() {
		t.Fatal("HasSynced must be false before the deadline (no store has synced)")
	}

	current = current.Add(time.Second) // advance past the deadline
	if !mgr.HasSynced() {
		t.Fatal("HasSynced must report settled after the deadline so Start stops blocking")
	}
}

// TestIngestManagerSkipsDeniedKindsAtStart pins permission-gating: a cut kind the
// permission filter denies must be skipped at Start — its reflector is never launched,
// and it is excluded from the readiness gate IMMEDIATELY (settled-as-skipped), not after
// the sync deadline. Without this, a denied kind's reflector 403-retries forever and the
// whole subsystem waits out the deadline before it can come up. Mirrors the informer
// factory's permission-skip (factory.go CanListWatch gate). The deadline here is set very
// long so the only way the denied kind can be settled is via the skip, not a degrade.
func TestIngestManagerSkipsDeniedKindsAtStart(t *testing.T) {
	mgr := NewIngestManager(testMeta, unreachableKube(t), nil, nil)
	var deniedGVR, allowedGVR schema.GroupVersionResource
	for g := range mgr.entries {
		if deniedGVR.Resource == "" {
			deniedGVR = g
			continue
		}
		allowedGVR = g
		break
	}
	if deniedGVR.Resource == "" || allowedGVR.Resource == "" {
		t.Fatal("need at least two entries to exercise deny-one/allow-one")
	}
	// Deny exactly one kind; allow everything else.
	mgr.SetPermissionFilter(func(group, resource string) bool {
		return !(group == deniedGVR.Group && resource == deniedGVR.Resource)
	})
	mgr.now = func() time.Time { return time.Unix(1_700_000_000, 0) }
	mgr.syncDeadline = time.Hour // so a settled denied kind can only be a SKIP, never a degrade

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	mgr.Start(ctx)

	if !mgr.HasSyncedFor(deniedGVR) {
		t.Fatalf("denied kind %s must be settled (skipped) immediately at start", deniedGVR)
	}
	if mgr.HasSyncedFor(allowedGVR) {
		t.Fatalf("allowed-but-unsynced kind %s must NOT be settled before sync or deadline", allowedGVR)
	}
}

// TestIngestManagerHasSyncedForDegradesAfterDeadline pins the same contract on the
// per-GVR readiness path (ingest_hub.go ingestKeySettled -> HasSyncedFor), which each
// cut domain's ResourcesSettled gate uses to decide it can serve.
func TestIngestManagerHasSyncedForDegradesAfterDeadline(t *testing.T) {
	mgr := NewIngestManager(testMeta, unreachableKube(t), nil, nil)
	var gvr schema.GroupVersionResource
	for g := range mgr.entries {
		gvr = g
		break
	}
	if gvr.Resource == "" {
		t.Fatal("expected at least one entry GVR")
	}
	current := time.Unix(1_700_000_000, 0)
	mgr.now = func() time.Time { return current }
	mgr.syncDeadline = 50 * time.Millisecond

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	mgr.Start(ctx)

	if mgr.HasSyncedFor(gvr) {
		t.Fatalf("HasSyncedFor(%s) must be false before the deadline", gvr)
	}
	current = current.Add(time.Second)
	if !mgr.HasSyncedFor(gvr) {
		t.Fatalf("HasSyncedFor(%s) must report settled after the deadline", gvr)
	}
}

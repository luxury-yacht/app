package system

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/refresh/ingest/ingesttest"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
)

func attentionRefNames(t *testing.T, h *reflectorHarness) []string {
	t.Helper()
	snap, err := h.subsystem.SnapshotService.Build(context.Background(), "cluster-attention", "c1|")
	require.NoError(t, err)
	payload, ok := snap.Payload.(snapshot.ClusterAttentionSnapshot)
	require.True(t, ok, "payload %T", snap.Payload)
	names := make([]string, 0, len(payload.Rows))
	for _, row := range payload.Rows {
		names = append(names, row.Ref.Kind+"/"+row.Ref.Name)
	}
	return names
}

// A Warning Event becomes an Attention finding through the events store. The
// index rings its doorbell after it applies the change, and the ring
// invalidates the cached Attention page first, so the refetch serves the
// finding; deleting the Event clears it the same way.
func TestClusterAttentionDoorbellServesEventFindingsFromTheEventsStore(t *testing.T) {
	server := newReflectorAPIServer(t)
	h := newReflectorHarness(t, server, "")
	sub := h.subscribe(t, "cluster-attention", "")
	require.Empty(t, attentionRefNames(t, h), "prime the cache")

	warning := &corev1.Event{
		ObjectMeta:     metav1.ObjectMeta{Name: "node-a.1", Namespace: "default"},
		InvolvedObject: corev1.ObjectReference{APIVersion: "v1", Kind: "Node", Name: "node-a"},
		Reason:         "NodeNotReady",
		Type:           corev1.EventTypeWarning,
		LastTimestamp:  metav1.NewTime(time.Now()),
	}
	server.Create(t, warning)

	for _, want := range [][]string{{"Event/node-a.1"}, {}} {
		select {
		case update := <-sub.Updates:
			require.Equal(t, "attention", string(update.Source))
		case <-time.After(3 * time.Second):
			t.Fatal("expected cluster attention doorbell")
		}
		require.ElementsMatch(t, want, attentionRefNames(t, h))
		if len(want) > 0 {
			server.Delete(t, warning)
		}
	}
}

// The namespace warning rollup and the Cluster Overview's Recent Events read
// the events store: a Warning Event about a Pod counts toward its namespace
// and is listed as a recent event once the store holds it.
func TestEventAggregatesReadTheEventsStore(t *testing.T) {
	server := newReflectorAPIServer(t)
	server.Create(t, &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "team-a"}})
	h := newReflectorHarness(t, server, "")
	namespaces := h.subscribe(t, "namespaces", "")

	server.Create(t, &corev1.Event{
		ObjectMeta:     metav1.ObjectMeta{Name: "web.1", Namespace: "team-a"},
		InvolvedObject: corev1.ObjectReference{APIVersion: "v1", Kind: "Pod", Namespace: "team-a", Name: "web", UID: "pod-uid"},
		Reason:         "BackOff",
		Message:        "Back-off restarting failed container",
		Type:           corev1.EventTypeWarning,
		LastTimestamp:  metav1.NewTime(time.Now()),
	})

	require.Eventually(t, func() bool {
		select {
		case <-namespaces.Updates:
		default:
		}
		snap, err := h.subsystem.SnapshotService.Build(context.Background(), "namespaces", "c1|")
		require.NoError(t, err)
		for _, row := range snap.Payload.(snapshot.NamespaceSnapshot).Namespaces {
			if row.Ref.Name == "team-a" {
				return row.WarningEvents == 1 && row.WarningEventsState == snapshot.NamespaceSignalAvailable
			}
		}
		return false
	}, 5*time.Second, 20*time.Millisecond, "the team-a warning rollup never counted the event")

	snap, err := h.subsystem.SnapshotService.Build(context.Background(), "cluster-overview", "c1|")
	require.NoError(t, err)
	recent := snap.Payload.(snapshot.ClusterOverviewSnapshot).Overview.RecentEvents
	require.Len(t, recent, 1)
	require.Equal(t, "BackOff", recent[0].Reason)
	require.Equal(t, "Back-off restarting failed container", recent[0].Message)
	require.Equal(t, "Pod", recent[0].ObjectKind)
	require.Equal(t, "web", recent[0].ObjectName)
	require.Equal(t, "team-a", recent[0].ObjectNamespace)
	require.Equal(t, "pod-uid", recent[0].ObjectUID)
	require.NotNil(t, recent[0].InvolvedObject)
}

// A re-warm restores the Attention findings and resumes the Events watch. A
// Warning Event deleted while the cluster was Cold must take its restored
// finding with it, though the resumed watch delivers only the delete; with no
// changes the restored finding stays.
func TestAttentionRewarmFollowsEventsChangedWhileCold(t *testing.T) {
	warning := func() *corev1.Event {
		event := tableEvent("node-a.1", "default", "Node", "")
		event.Type = corev1.EventTypeWarning
		event.Reason = "NodeNotReady"
		return event
	}
	start := func(t *testing.T) (*ingesttest.APIServer, string) {
		t.Helper()
		server := newReflectorAPIServer(t)
		server.Create(t, warning())
		before := newReflectorHarness(t, server, "")
		require.Eventually(t, func() bool {
			return slices.Equal([]string{"Event/node-a.1"}, attentionRefNames(t, before))
		}, 5*time.Second, 20*time.Millisecond)
		return server, before.spill(t)
	}

	t.Run("no changes while Cold", func(t *testing.T) {
		server, spill := start(t)
		after := newReflectorHarness(t, server, spill)
		require.Equal(t, []string{"Event/node-a.1"}, attentionRefNames(t, after))
	})
	t.Run("deleted while Cold, watch resumes", func(t *testing.T) {
		server, spill := start(t)
		server.Delete(t, warning())
		after := newReflectorHarness(t, server, spill)
		require.Eventually(t, func() bool {
			return len(attentionRefNames(t, after)) == 0
		}, 5*time.Second, 20*time.Millisecond, "the restored finding outlived its deleted Event")
	})
}

// Node and workload stores keep no Table half after intake, so a re-warm
// cannot rebuild their Attention source records from the restored rows. Their
// restored findings must survive an unchanged re-warm, and deleting the object
// while the watch resumes must still clear its finding.
func TestAttentionRewarmKeepsFindingsItCannotRebuild(t *testing.T) {
	notReady := func() *corev1.Node {
		return &corev1.Node{
			ObjectMeta: metav1.ObjectMeta{Name: "node-a", UID: "node-a-uid"},
			Status: corev1.NodeStatus{Conditions: []corev1.NodeCondition{
				{Type: corev1.NodeReady, Status: corev1.ConditionFalse, Reason: "KubeletNotReady"},
			}},
		}
	}
	server := newReflectorAPIServer(t)
	server.Create(t, notReady())
	before := newReflectorHarness(t, server, "")
	require.Eventually(t, func() bool {
		return slices.Equal([]string{"Node/node-a"}, attentionRefNames(t, before))
	}, 5*time.Second, 20*time.Millisecond)
	spill := before.spill(t)

	after := newReflectorHarness(t, server, spill)
	require.Equal(t, []string{"Node/node-a"}, attentionRefNames(t, after), "an unchanged re-warm dropped the node's finding")

	server.Delete(t, notReady())
	require.Eventually(t, func() bool {
		return len(attentionRefNames(t, after)) == 0
	}, 5*time.Second, 20*time.Millisecond, "the restored node finding outlived its deleted node")
}

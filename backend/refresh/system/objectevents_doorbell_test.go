package system

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
)

func objectEventNames(t *testing.T, h *reflectorHarness, scope string) []string {
	t.Helper()
	snap, err := h.subsystem.SnapshotService.Build(context.Background(), "object-events", "c1|"+scope)
	require.NoError(t, err)
	payload, ok := snap.Payload.(snapshot.ObjectEventsSnapshotPayload)
	require.True(t, ok, "payload %T", snap.Payload)
	names := make([]string, 0, len(payload.Events))
	for _, event := range payload.Events {
		names = append(names, event.Ref.Name)
	}
	return names
}

// An Event change rings the involved object's Events tab after the events
// store holds it, and the ring invalidates the cached object-events page first,
// so the refetch it triggers serves the change. A sibling object's tab stays
// silent.
func TestObjectEventsDoorbellRefetchServesTheStoredEvent(t *testing.T) {
	server := newReflectorAPIServer(t)
	h := newReflectorHarness(t, server, "")
	sub := h.subscribe(t, "object-events", "team-a:/v1:Pod:web-1")
	other := h.subscribe(t, "object-events", "team-a:/v1:Pod:other")
	require.Empty(t, objectEventNames(t, h, "team-a:/v1:Pod:web-1"), "prime the cache")

	server.Create(t, &corev1.Event{
		ObjectMeta:     metav1.ObjectMeta{Namespace: "team-a", Name: "web-1.evt"},
		InvolvedObject: corev1.ObjectReference{APIVersion: "v1", Kind: "Pod", Namespace: "team-a", Name: "web-1"},
		Reason:         "BackOff",
		Type:           corev1.EventTypeWarning,
		LastTimestamp:  metav1.NewTime(time.Now()),
	})

	select {
	case update := <-sub.Updates:
		require.Equal(t, "object-events", update.Domain)
		require.Equal(t, "team-a:/v1:Pod:web-1", update.Scope)
		require.Equal(t, resourcestream.SourceEvent, update.Source)
		require.Equal(t, resourcestream.SignalChanged, update.Signal)
		require.NotEmpty(t, update.Version)
	case <-time.After(3 * time.Second):
		t.Fatal("expected an object-events doorbell update")
	}
	require.Equal(t, []string{"web-1.evt"}, objectEventNames(t, h, "team-a:/v1:Pod:web-1"),
		"the doorbell must have invalidated the cached object-events page")
	requireQuiet(t, 750*time.Millisecond, map[string]*resourcestream.Subscription{"sibling object": other})
}

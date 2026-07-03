package system

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
)

// Pins the object-events doorbell wiring shape: the change notifier's broadcast
// is the stream manager's BroadcastObjectEventsRefresh, so an event for a
// panel's object fans a SourceEvent doorbell to that object's subscribed
// events scope — this is what lets the Events tab refetch on push instead of
// the 10s poll. A sibling object's subscription stays silent.
func TestObjectEventsNotifierBroadcastsDoorbellThroughStreamManager(t *testing.T) {
	manager := resourcestream.NewManager(
		nil,
		nil,
		nil,
		nil,
		snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		nil,
		nil,
	)
	selector, err := resourcestream.ParseStreamSelector("c1", "object-events", "team-a:/v1:Pod:web-1")
	require.NoError(t, err)
	sub, err := manager.SubscribeSelector(selector)
	require.NoError(t, err)

	otherSelector, err := resourcestream.ParseStreamSelector("c1", "object-events", "team-a:/v1:Pod:other")
	require.NoError(t, err)
	otherSub, err := manager.SubscribeSelector(otherSelector)
	require.NoError(t, err)

	notifier := snapshot.NewObjectEventsChangeNotifier()
	defer notifier.Stop()
	notifier.SetBroadcast(manager.BroadcastObjectEventsRefresh)

	notifier.EventChanged(&corev1.Event{
		ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "web-1.evt"},
		InvolvedObject: corev1.ObjectReference{
			APIVersion: "v1",
			Kind:       "Pod",
			Namespace:  "team-a",
			Name:       "web-1",
		},
	})

	deadline := time.After(3 * time.Second)
	select {
	case update := <-sub.Updates:
		require.Equal(t, "object-events", update.Domain)
		require.Equal(t, "team-a:/v1:Pod:web-1", update.Scope)
		require.Equal(t, resourcestream.SourceEvent, update.Source)
		require.Equal(t, resourcestream.SignalChanged, update.Signal)
		require.NotEmpty(t, update.Version)
	case <-deadline:
		t.Fatal("expected an object-events doorbell update")
	}

	select {
	case unexpected := <-otherSub.Updates:
		t.Fatalf("sibling object's subscription must stay silent, got %+v", unexpected)
	default:
	}
}

package system

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
)

// Pins the object-events doorbell wiring: the notifier's broadcast — wired
// through the SAME helper production uses — invalidates the object-events
// snapshot cache FIRST and then fans a SourceEvent doorbell to the involved
// object's subscribed events scope (a sibling object's subscription stays
// silent). The invalidate-then-broadcast ordering is what keeps the Events
// tab's push refetch from being served the pre-change cached snapshot.
func TestObjectEventsNotifierInvalidatesCacheThenBroadcastsDoorbell(t *testing.T) {
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

	// A real snapshot service with a counting object-events builder, its cache
	// primed with the pre-change build.
	reg := domain.New()
	builds := 0
	require.NoError(t, reg.Register(refresh.DomainConfig{
		Name: "object-events",
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			builds++
			return &refresh.Snapshot{
				Domain:  "object-events",
				Scope:   scope,
				Payload: map[string]int{"build": builds},
			}, nil
		},
	}))
	service := snapshot.NewService(reg, nil, snapshot.ClusterMeta{ClusterID: "c1"})
	manager.SetSnapshotDomainInvalidator(service.InvalidateDomainCache)
	_, err = service.Build(context.Background(), "object-events", "c1|team-a:/v1:Pod:web-1")
	require.NoError(t, err)
	_, err = service.Build(context.Background(), "object-events", "c1|team-a:/v1:Pod:web-1")
	require.NoError(t, err)
	require.Equal(t, 1, builds, "cache must serve the second pre-change build")

	notifier := snapshot.NewObjectEventsChangeNotifier()
	defer notifier.Stop()
	wireObjectEventsDoorbell(notifier, manager)

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

	// The refetch the doorbell triggers must REBUILD, not replay the cache.
	_, err = service.Build(context.Background(), "object-events", "c1|team-a:/v1:Pod:web-1")
	require.NoError(t, err)
	require.Equal(t, 2, builds, "the doorbell must have invalidated the cached object-events snapshot")
}

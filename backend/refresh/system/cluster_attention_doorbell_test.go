package system

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/stretchr/testify/require"
)

type fakeAttentionDoorbell struct {
	broadcast func(string)
}

func (f *fakeAttentionDoorbell) SetBroadcast(broadcast func(string)) {
	f.broadcast = broadcast
}

func TestClusterAttentionDoorbellInvalidatesCacheBeforeBroadcast(t *testing.T) {
	manager := resourcestream.NewManager(
		nil, nil, nil, nil,
		snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		nil, nil,
	)
	selector, err := resourcestream.ParseStreamSelector("c1", "cluster-attention", "")
	require.NoError(t, err)
	subscription, err := manager.SubscribeSelector(selector)
	require.NoError(t, err)

	registry := domain.New()
	builds := 0
	require.NoError(t, registry.Register(refresh.DomainConfig{
		Name: "cluster-attention",
		BuildSnapshot: func(_ context.Context, scope string) (*refresh.Snapshot, error) {
			builds++
			return &refresh.Snapshot{Domain: "cluster-attention", Scope: scope, Payload: builds}, nil
		},
	}))
	service := snapshot.NewService(registry, nil, snapshot.ClusterMeta{ClusterID: "c1"})
	manager.SetSnapshotDomainInvalidator(service.InvalidateDomainCache)
	_, err = service.Build(context.Background(), "cluster-attention", "c1|")
	require.NoError(t, err)
	_, err = service.Build(context.Background(), "cluster-attention", "c1|")
	require.NoError(t, err)
	require.Equal(t, 1, builds)

	notifier := &fakeAttentionDoorbell{}
	wireClusterAttentionDoorbell(notifier, manager)
	notifier.broadcast("attention-2")

	var update resourcestream.Update
	select {
	case update = <-subscription.Updates:
	case <-time.After(time.Second):
		t.Fatal("expected cluster attention doorbell")
	}
	require.Equal(t, "attention", string(update.Source))
	_, err = service.Build(context.Background(), "cluster-attention", "c1|")
	require.NoError(t, err)
	require.Equal(t, 2, builds)
}

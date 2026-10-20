package system

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
)

// The attention index rings its doorbell on the resource stream after it
// applies a change, and the ring invalidates the cached Attention snapshot
// first, so the refetch it triggers never replays the pre-change page.
func TestClusterAttentionDoorbellInvalidatesCacheBeforeBroadcast(t *testing.T) {
	meta := snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}
	registry := domain.New()
	builds := 0
	require.NoError(t, registry.Register(refresh.DomainConfig{
		Name: "cluster-attention",
		BuildSnapshot: func(_ context.Context, scope string) (*refresh.Snapshot, error) {
			builds++
			return &refresh.Snapshot{Domain: "cluster-attention", Scope: scope, Payload: builds}, nil
		},
	}))
	service := snapshot.NewServiceWithPermissions(registry, nil, snapshot.ClusterMeta{ClusterID: "c1"}, nil)
	manager := resourcestream.NewManager(nil, nil, meta, service.InvalidateDomainCache)
	t.Cleanup(manager.Stop)
	selector, err := resourcestream.ParseStreamSelector("c1", "cluster-attention", "")
	require.NoError(t, err)
	subscription, err := manager.SubscribeSelector(selector)
	require.NoError(t, err)
	_, err = service.Build(context.Background(), "cluster-attention", "c1|")
	require.NoError(t, err)
	_, err = service.Build(context.Background(), "cluster-attention", "c1|")
	require.NoError(t, err)
	require.Equal(t, 1, builds)

	client := fake.NewClientset()
	factory := informers.NewSharedInformerFactory(client, 0)
	_, err = snapshot.RegisterClusterAttentionDomain(domain.New(), factory,
		snapshot.ClusterAttentionPermissions{IncludeEvents: true}, meta, nil, snapshot.ClusterAttentionOptions{}, manager)
	require.NoError(t, err)
	stop := make(chan struct{})
	t.Cleanup(func() { close(stop) })
	factory.Start(stop)
	factory.WaitForCacheSync(stop)

	_, err = client.CoreV1().Events("default").Create(context.Background(), &corev1.Event{
		ObjectMeta:     metav1.ObjectMeta{Name: "node-a.1", Namespace: "default", ResourceVersion: "5", UID: "event-uid"},
		InvolvedObject: corev1.ObjectReference{APIVersion: "v1", Kind: "Node", Name: "node-a"},
		Reason:         "NodeNotReady",
		Type:           corev1.EventTypeWarning,
		LastTimestamp:  metav1.NewTime(time.Now()),
	}, metav1.CreateOptions{})
	require.NoError(t, err)

	var update resourcestream.Update
	select {
	case update = <-subscription.Updates:
	case <-time.After(3 * time.Second):
		t.Fatal("expected cluster attention doorbell")
	}
	require.Equal(t, "attention", string(update.Source))
	_, err = service.Build(context.Background(), "cluster-attention", "c1|")
	require.NoError(t, err)
	require.Equal(t, 2, builds)
}

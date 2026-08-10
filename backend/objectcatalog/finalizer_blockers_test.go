package objectcatalog

import (
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
)

func TestFinalizerBlockerSubscriptionPublishesOnlyRelevantChanges(t *testing.T) {
	deletingAt := time.Date(2026, time.August, 10, 12, 0, 0, 0, time.UTC)
	service := NewService(Dependencies{ClusterID: "cluster-a"}, nil)
	updates, unsubscribe := service.SubscribeFinalizerBlockers()
	defer unsubscribe()

	initial := <-updates
	require.Zero(t, initial.Revision)

	blocked := Summary{
		Ref: resourcemodel.ResourceRef{
			ClusterID: "cluster-a", Group: "example.com", Version: "v1", Kind: "Widget", Resource: "widgets",
			Namespace: "default", Name: "sample", UID: "widget-uid",
		},
		ResourceVersion: "1",
		lifecycle:       resourcemodel.ResourceLifecycle{Deleting: true, FinalizerBlocked: true},
		deletionTime:    deletingAt.UnixMilli(),
	}
	service.rebuildCacheFromItems(map[string]Summary{"widget": blocked}, nil)

	update := <-updates
	require.Equal(t, uint64(1), update.Revision)
	require.Equal(t, []FinalizerBlocker{{Ref: blocked.Ref, DeletionTimestamp: deletingAt.UnixMilli()}}, service.FinalizerBlockers())

	blocked.ResourceVersion = "2"
	service.rebuildCacheFromItems(map[string]Summary{"widget": blocked}, nil)
	select {
	case unexpected := <-updates:
		t.Fatalf("resource-version-only update emitted blocker revision %d", unexpected.Revision)
	default:
	}

	blocked.lifecycle.FinalizerBlocked = false
	service.rebuildCacheFromItems(map[string]Summary{"widget": blocked}, nil)
	update = <-updates
	require.Equal(t, uint64(2), update.Revision)
	require.Empty(t, service.FinalizerBlockers())
}

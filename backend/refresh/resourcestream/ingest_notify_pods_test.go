package resourcestream

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
)

// podBundleFor builds the four-half-ish ingest Bundle the pod reflector projects: the
// Table half is the PodSummary (scopes), the Catalog half is the catalog Summary (UID/RV).
func podBundleFor(namespace, name, node, uid, rv string, owner [3]string) ingest.Bundle {
	return ingest.Bundle{
		Table: snapshot.PodSummary{
			ClusterMeta:     streamrows.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
			Namespace:       namespace,
			Name:            name,
			Node:            node,
			OwnerKind:       owner[0],
			OwnerName:       owner[1],
			OwnerAPIVersion: owner[2],
		},
		Catalog: objectcatalog.Summary{
			Namespace:       namespace,
			Name:            name,
			UID:             uid,
			ResourceVersion: rv,
		},
	}
}

// TestPodNotifyBundleSinkBroadcastsPodRowSignal proves the ingest-fed pod notify sink
// emits the pod-row change signal (Ref with the catalog UID/RV, no row) on the pod's
// namespace scope — the same signal-only signal the typed pod handler emitted, with no
// typed pod informer.
func TestPodNotifyBundleSinkBroadcastsPodRowSignal(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}
	sub, err := subscribeForTest(t, manager, domainPods, "namespace:default")
	require.NoError(t, err)

	sink := podNotifyBundleSink{manager: manager}
	sink.UpsertBundle(podBundleFor("default", "pod-1", "node-a", "pod-uid", "12", [3]string{"None", "None", ""}))

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeModified, update.Type)
		require.Equal(t, domainPods, update.Domain)
		require.Equal(t, "namespace:default", update.Scope)
		require.Equal(t, "pod-1", update.Ref.Name)
		require.Equal(t, "default", update.Ref.Namespace)
		require.Equal(t, "pod-uid", update.Ref.UID)
		require.Equal(t, "12", update.ResourceVersion)
	default:
		t.Fatal("expected a pod-row signal to be delivered")
	}
}

// TestPodNotifyBundleSinkBroadcastsNodeScope proves the pod signal reaches the node scope
// when the pod is scheduled, so a node-scoped subscriber refetches on a pod change.
func TestPodNotifyBundleSinkBroadcastsNodeScope(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}
	sub, err := subscribeForTest(t, manager, domainPods, "node:node-a")
	require.NoError(t, err)

	sink := podNotifyBundleSink{manager: manager}
	sink.UpsertBundle(podBundleFor("default", "pod-1", "node-a", "pod-uid", "12", [3]string{"None", "None", ""}))

	select {
	case update := <-sub.Updates:
		require.Equal(t, "node:node-a", update.Scope)
		require.Equal(t, "pod-1", update.Ref.Name)
	default:
		t.Fatal("expected the pod signal to reach the node scope")
	}
}

// TestPodNotifyBundleSinkDeleteSignalsDeleted proves DeleteBundle emits a DELETED signal.
func TestPodNotifyBundleSinkDeleteSignalsDeleted(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}
	sub, err := subscribeForTest(t, manager, domainPods, "namespace:default")
	require.NoError(t, err)

	sink := podNotifyBundleSink{manager: manager}
	sink.DeleteBundle(podBundleFor("default", "pod-1", "", "pod-uid", "13", [3]string{"None", "None", ""}))

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeDeleted, update.Type)
		require.Equal(t, "pod-1", update.Ref.Name)
	default:
		t.Fatal("expected a DELETED pod signal")
	}
}

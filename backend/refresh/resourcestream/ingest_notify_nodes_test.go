package resourcestream

import (
	"testing"

	"github.com/stretchr/testify/require"

	applog "github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// fakeNodeBundleSource is a test nodeBundleSource returning the supplied node bundles for
// NodeGVR, standing in for the ingest manager's Rows in the node notify unit tests.
type fakeNodeBundleSource struct {
	bundles []ingest.Bundle
}

func (s fakeNodeBundleSource) Rows(gvr schema.GroupVersionResource) []interface{} {
	if gvr != nodeGVR {
		return nil
	}
	out := make([]interface{}, 0, len(s.bundles))
	for _, b := range s.bundles {
		out = append(out, b)
	}
	return out
}

func nodeBundle(name, uid, resourceVersion string) ingest.Bundle {
	return ingest.Bundle{
		Catalog: objectcatalog.Summary{Name: name, UID: uid, ResourceVersion: resourceVersion},
	}
}

// TestNodeNotifyCatalogSinkBroadcastsChangeSignal proves the ingest Catalog-half sink emits
// the byte-equivalent signal-only node change signal the typed handleNode did: a Ref carrying
// the node's identity + UID, the catalog RV, and the cluster scope, with no projected row.
func TestNodeNotifyCatalogSinkBroadcastsChangeSignal(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}
	sub, err := subscribeForTest(t, manager, domainNodes, "")
	require.NoError(t, err)

	sink := nodeNotifyCatalogSink{manager: manager}
	sink.Upsert(objectcatalog.Summary{Name: "node-a", UID: "node-uid", ResourceVersion: "9"})

	update := requireNextUpdate(t, sub)
	require.Equal(t, MessageTypeModified, update.Type)
	require.Equal(t, domainNodes, update.Domain)
	require.Equal(t, "node-a", update.Ref.Name)
	require.Equal(t, "Node", update.Ref.Kind)
	require.Equal(t, "node-uid", update.Ref.UID)
	require.Equal(t, "9", update.ResourceVersion)

	sink.Delete(objectcatalog.Summary{Name: "node-a", UID: "node-uid", ResourceVersion: "10"})
	del := requireNextUpdate(t, sub)
	require.Equal(t, MessageTypeDeleted, del.Type)
	require.Equal(t, "node-a", del.Ref.Name)
}

// TestBroadcastNodeFromPodNodeResolvesViaIngest proves the pod-derived node signal resolves
// the node's Ref + resourceVersion from the ingest node store (no typed lister), emitting the
// same notify the typed handleNodeFromPod did.
func TestBroadcastNodeFromPodNodeResolvesViaIngest(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		nodeIngest:  fakeNodeBundleSource{bundles: []ingest.Bundle{nodeBundle("node-a", "node-uid", "7")}},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}
	sub, err := subscribeForTest(t, manager, domainNodes, "")
	require.NoError(t, err)

	manager.broadcastNodeFromPodNode("node-a")

	update := requireNextUpdate(t, sub)
	require.Equal(t, MessageTypeModified, update.Type)
	require.Equal(t, domainNodes, update.Domain)
	require.Equal(t, "node-a", update.Ref.Name)
	require.Equal(t, "Node", update.Ref.Kind)
	require.Equal(t, "node-uid", update.Ref.UID)
	require.Equal(t, "7", update.ResourceVersion)
}

// TestBroadcastNodeFromPodNodeSkipsUnknownNode proves a node not in the ingest store is
// skipped (no notify), matching the typed nodeLister.Get-error skip.
func TestBroadcastNodeFromPodNodeSkipsUnknownNode(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		nodeIngest:  fakeNodeBundleSource{bundles: []ingest.Bundle{nodeBundle("node-a", "node-uid", "7")}},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}
	sub, err := subscribeForTest(t, manager, domainNodes, "")
	require.NoError(t, err)

	manager.broadcastNodeFromPodNode("missing-node")

	select {
	case <-sub.Updates:
		t.Fatal("expected no notify for a node absent from the ingest store")
	default:
	}
}

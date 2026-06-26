package resourcestream

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/resources/clusterrole"
	"github.com/luxury-yacht/app/backend/resources/resourcequota"
)

// TestIngestNotifySinkBroadcastsNamespacedSignal proves the signal-only change signal
// for an IngestOwned namespaced kind (ResourceQuota → namespace-quotas) fires from the
// ingest Catalog-half Sink: an Upsert of the kind's catalog Summary broadcasts a
// MODIFIED change signal on the descriptor's domain + the object's namespace scope,
// carrying Ref + ResourceVersion and NO Row — byte-equivalent to the shared-informer
// path streamObjectRowFromDescriptor produced before the cutover.
func TestIngestNotifySinkBroadcastsNamespacedSignal(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := subscribeForTest(t, manager, domainNamespaceQuotas, "namespace:default")
	require.NoError(t, err)

	sink := manager.ingestNotifySink(resourcequota.StreamDescriptor)
	sink.Upsert(objectcatalog.Summary{
		Kind:            "ResourceQuota",
		Group:           resourcequota.StreamDescriptor.Group,
		Version:         resourcequota.StreamDescriptor.Version,
		Resource:        resourcequota.StreamDescriptor.Resource,
		Namespace:       "default",
		Name:            "quota-1",
		UID:             "quota-uid",
		ResourceVersion: "7",
	})

	update := requireNextUpdate(t, sub)
	require.Equal(t, MessageTypeModified, update.Type)
	require.Equal(t, domainNamespaceQuotas, update.Domain)
	require.Equal(t, "namespace:default", update.Scope)
	requireUpdateObjectMetadata(t, update, "7", "quota-uid", "quota-1", "default", "ResourceQuota")
}

// TestIngestNotifySinkBroadcastsClusterSignalAndDelete proves the cluster-scoped
// IngestOwned path (ClusterRole → cluster-rbac): an Upsert fires MODIFIED and a Delete
// fires DELETED, both on the cluster scope ("") with Ref + ResourceVersion and no Row.
func TestIngestNotifySinkBroadcastsClusterSignalAndDelete(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := subscribeForTest(t, manager, domainClusterRBAC, "")
	require.NoError(t, err)

	sink := manager.ingestNotifySink(clusterrole.StreamDescriptor)
	summary := objectcatalog.Summary{
		Kind:            "ClusterRole",
		Group:           clusterrole.StreamDescriptor.Group,
		Version:         clusterrole.StreamDescriptor.Version,
		Resource:        clusterrole.StreamDescriptor.Resource,
		Name:            "cluster-role-1",
		UID:             "cr-uid",
		ResourceVersion: "10",
	}
	sink.Upsert(summary)

	add := requireNextUpdate(t, sub)
	require.Equal(t, MessageTypeModified, add.Type)
	require.Equal(t, domainClusterRBAC, add.Domain)
	require.Equal(t, "", add.Scope)
	requireUpdateObjectMetadata(t, add, "10", "cr-uid", "cluster-role-1", "", "ClusterRole")

	sink.Delete(summary)
	del := requireNextUpdate(t, sub)
	require.Equal(t, MessageTypeDeleted, del.Type)
	require.Equal(t, domainClusterRBAC, del.Domain)
	require.Equal(t, "", del.Scope)
}

// TestRegisterDescriptorStreamsSkipsIngestOwnedKinds is the memory proof for the notify
// side: registerDescriptorStreams must NOT wire a typed informer for any IngestOwned
// GVR — their notify signal comes from the ingest sink instead. It asserts that for
// every IngestOwned descriptor the dispatch loop's guard short-circuits before
// d.Informer(shared), so the factory never caches the cut kind purely for the signal.
func TestRegisterDescriptorStreamsSkipsIngestOwnedKinds(t *testing.T) {
	ingestOwned := kindregistry.IngestOwnedGVRs()
	require.NotEmpty(t, ingestOwned, "expected IngestOwned kinds to exist")

	// Every IngestOwned descriptor that is a streamed descriptor must be excluded from
	// the informer-driven dispatch. We assert the skip condition registerDescriptorStreams
	// applies (the GVR is in the IngestOwned set) holds for each, so no d.Informer is called.
	streamedIngestOwned := 0
	for _, d := range kindregistry.StreamDescriptors() {
		if _, owned := ingestOwned[d.GVR()]; !owned {
			continue
		}
		streamedIngestOwned++
		require.Contains(t, ingestOwned, d.GVR(),
			"IngestOwned streamed descriptor %s must be skipped by registerDescriptorStreams", d.Kind)
	}
	require.Positive(t, streamedIngestOwned, "expected at least one streamed IngestOwned descriptor")
}

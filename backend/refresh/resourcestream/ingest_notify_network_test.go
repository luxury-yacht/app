package resourcestream

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	endpointslicepkg "github.com/luxury-yacht/app/backend/resources/endpointslice"
	servicepkg "github.com/luxury-yacht/app/backend/resources/service"
)

// TestNetworkNotifyCatalogSinkBroadcastsServiceSignal proves the bespoke Service signal-only
// change signal fires from the ingest Catalog-half Sink: an Upsert of the Service catalog
// Summary broadcasts a MODIFIED change signal on namespace-network + the Service's namespace
// scope, carrying Ref + ResourceVersion and NO Row — byte-equivalent to the typed
// handleService broadcast (which dropped the row). Service has no Stream descriptor, so the
// generic ingest notify does not cover it; this sink is its ingest twin.
func TestNetworkNotifyCatalogSinkBroadcastsServiceSignal(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := subscribeForTest(t, manager, domainNamespaceNetwork, "namespace:default")
	require.NoError(t, err)

	sink := networkNotifyCatalogSink{manager: manager, identity: servicepkg.Identity}
	summary := objectcatalog.Summary{
		Kind:            servicepkg.Identity.Kind,
		Group:           servicepkg.Identity.Group,
		Version:         servicepkg.Identity.Version,
		Resource:        servicepkg.Identity.Resource,
		Namespace:       "default",
		Name:            "svc-1",
		UID:             "svc-uid",
		ResourceVersion: "3",
	}
	sink.Upsert(summary)

	add := requireNextUpdate(t, sub)
	require.Equal(t, MessageTypeModified, add.Type)
	require.Equal(t, domainNamespaceNetwork, add.Domain)
	require.Equal(t, "namespace:default", add.Scope)
	requireUpdateObjectMetadata(t, add, "3", "svc-uid", "svc-1", "default", "Service")

	sink.Delete(summary)
	del := requireNextUpdate(t, sub)
	require.Equal(t, MessageTypeDeleted, del.Type)
	require.Equal(t, domainNamespaceNetwork, del.Domain)
}

// TestNetworkNotifyCatalogSinkBroadcastsEndpointSliceSignal proves the bespoke EndpointSlice
// signal-only change signal fires from the Catalog-half Sink on namespace-network + the
// slice's namespace scope. The slice's namespace-scoped signal already refetches every
// Service row in the namespace (Service and EndpointSlice share the namespace-network domain
// AND scope), so no separate derived per-Service signal is needed — the namespace refetch
// covers the owning Service's endpoint count change.
func TestNetworkNotifyCatalogSinkBroadcastsEndpointSliceSignal(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := subscribeForTest(t, manager, domainNamespaceNetwork, "namespace:default")
	require.NoError(t, err)

	sink := networkNotifyCatalogSink{manager: manager, identity: endpointslicepkg.Identity}
	sink.Upsert(objectcatalog.Summary{
		Kind:            endpointslicepkg.Identity.Kind,
		Group:           endpointslicepkg.Identity.Group,
		Version:         endpointslicepkg.Identity.Version,
		Resource:        endpointslicepkg.Identity.Resource,
		Namespace:       "default",
		Name:            "slice-1",
		UID:             "slice-uid",
		ResourceVersion: "5",
	})

	update := requireNextUpdate(t, sub)
	require.Equal(t, MessageTypeModified, update.Type)
	require.Equal(t, domainNamespaceNetwork, update.Domain)
	require.Equal(t, "namespace:default", update.Scope)
	requireUpdateObjectMetadata(t, update, "5", "slice-uid", "slice-1", "default", "EndpointSlice")
}

package resourcestream

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/clusterrole"
	"github.com/luxury-yacht/app/backend/resources/clusterrolebinding"
	"github.com/luxury-yacht/app/backend/resources/resourcequota"
	"github.com/luxury-yacht/app/backend/resources/rolebinding"
	"github.com/luxury-yacht/app/backend/resources/serviceaccount"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	clienttesting "k8s.io/client-go/testing"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
	gatewayfake "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned/fake"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"
)

func TestIdentitySourcesSignalClusterViewOnChangeAndDeletion(t *testing.T) {
	for _, descriptor := range []streamspec.Descriptor{rolebinding.StreamDescriptor, clusterrolebinding.StreamDescriptor} {
		t.Run(descriptor.Kind, func(t *testing.T) {
			manager := &Manager{clusterMeta: snapshot.ClusterMeta{ClusterID: "c1"}, logger: applog.Noop,
				subscribers: make(map[string]map[string]map[uint64]*subscription)}
			sub, err := subscribeForTest(t, manager, "cluster-identities", "")
			require.NoError(t, err)
			summary := objectcatalog.Summary{Ref: resourcemodel.ResourceRef{
				ClusterID: "c1", Group: descriptor.Group, Version: descriptor.Version,
				Kind: descriptor.Kind, Resource: descriptor.Resource, Namespace: "team-a", Name: "readers",
			}, ResourceVersion: "17"}
			sink := manager.ingestNotifySink(descriptor)
			sink.Upsert(summary)
			added := requireNextUpdate(t, sub)
			require.Equal(t, "cluster-identities", added.Domain)
			require.Equal(t, "", added.Scope)
			require.Equal(t, "c1", added.ClusterID)
			require.Equal(t, SourceObject, added.Source)
			sink.Delete(summary)
			deleted := requireNextUpdate(t, sub)
			require.Equal(t, MessageTypeDeleted, deleted.Type)
		})
	}
}

func TestServiceAccountChangesSignalRBACWithoutSignalingIdentities(t *testing.T) {
	manager := &Manager{clusterMeta: snapshot.ClusterMeta{ClusterID: "c1"}, logger: applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription)}
	identities, err := subscribeForTest(t, manager, "cluster-identities", "")
	require.NoError(t, err)
	rbac, err := subscribeForTest(t, manager, serviceaccount.StreamDescriptor.Domain, "namespace:team-a")
	require.NoError(t, err)
	summary := objectcatalog.Summary{Ref: resourcemodel.ResourceRef{
		ClusterID: "c1", Version: "v1", Kind: "ServiceAccount", Resource: "serviceaccounts", Namespace: "team-a", Name: "builder",
	}, ResourceVersion: "17"}
	sink := manager.ingestNotifySink(serviceaccount.StreamDescriptor)
	sink.Upsert(summary)
	require.Equal(t, MessageTypeModified, requireNextUpdate(t, rbac).Type)
	sink.Delete(summary)
	require.Equal(t, MessageTypeDeleted, requireNextUpdate(t, rbac).Type)
	select {
	case update := <-identities.Updates:
		t.Fatalf("service account change reached identities: %#v", update)
	default:
	}
}

// TestIngestNotifySinkBroadcastsNamespacedSignal proves the signal-only change signal
// for an IngestOwned namespaced kind (ResourceQuota → namespace-quotas) fires from the
// ingest Catalog-half Sink: an Upsert of the kind's catalog Summary broadcasts a
// MODIFIED change signal on the descriptor's domain + the object's namespace scope,
// carrying Ref + ResourceVersion and NO Row — byte-equivalent to the shared-informer
// path broadcastObjectFromDescriptor produced before the cutover.
func TestIngestNotifySinkBroadcastsNamespacedSignal(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      applog.Noop,
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := subscribeForTest(t, manager, domainNamespaceQuotas, "namespace:default")
	require.NoError(t, err)

	sink := manager.ingestNotifySink(resourcequota.StreamDescriptor)
	sink.Upsert(objectcatalog.Summary{Ref: resourcemodel.ResourceRef{Group: resourcequota.StreamDescriptor.Group, Version: resourcequota.StreamDescriptor.Version, Kind: "ResourceQuota", Resource: resourcequota.StreamDescriptor.Resource, Namespace: "default", Name: "quota-1", UID: "quota-uid"}, ResourceVersion: "7"})

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
	summary := objectcatalog.Summary{Ref: resourcemodel.ResourceRef{Group: clusterrole.StreamDescriptor.Group, Version: clusterrole.StreamDescriptor.Version, Kind: "ClusterRole", Resource: clusterrole.StreamDescriptor.Resource, Name: "cluster-role-1", UID: "cr-uid"}, ResourceVersion: "10"}
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

type gatewayStreamPresence struct{}

func (gatewayStreamPresence) AnyPresent() bool     { return true }
func (gatewayStreamPresence) Has(kind string) bool { return kind == "Gateway" }

func TestDescriptorRegistrationStreamsGatewayWithoutRecreatingIngestWatches(t *testing.T) {
	client := fake.NewClientset()
	checker := permissions.NewCheckerWithReview("c1", time.Minute, func(context.Context, string, string, string, string) (bool, error) {
		return true, nil
	})
	gatewayClient := gatewayfake.NewClientset()
	gatewayClient.PrependReactor("list", "gateways", func(clienttesting.Action) (bool, runtime.Object, error) {
		return true, &gatewayv1.GatewayList{Items: []gatewayv1.Gateway{{
			ObjectMeta: metav1.ObjectMeta{Name: "edge", Namespace: "default", UID: "gateway-uid", ResourceVersion: "7"},
		}}}, nil
	})
	factory := informer.New(client, nil, time.Minute, checker).WithGatewayFactory(
		gatewayinformers.NewSharedInformerFactory(gatewayClient, time.Minute), gatewayStreamPresence{},
	)
	manager := NewManager(nil, nil, nil, snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}, nil)
	t.Cleanup(manager.Stop)
	manager.permissions = factory
	require.True(t, factory.CanListWatch("gateway.networking.k8s.io", "gateways"))
	manager.registerDescriptorStreams(factory)
	sub, err := subscribeForTest(t, manager, domainNamespaceNetwork, "namespace:default")
	require.NoError(t, err)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	require.NoError(t, factory.Start(ctx))
	for resource, synced := range factory.SharedInformerFactory().WaitForCacheSync(ctx.Done()) {
		require.True(t, synced, "informer did not sync: %v", resource)
	}
	update := requireNextUpdate(t, sub)
	require.Equal(t, domainNamespaceNetwork, update.Domain)
	require.Equal(t, "namespace:default", update.Scope)
	requireUpdateObjectMetadata(t, update, "7", "gateway-uid", "edge", "default", "Gateway")
	require.Equal(t, "gateway.networking.k8s.io", update.Ref.Group)
	require.Equal(t, "v1", update.Ref.Version)

	owned := kindregistry.IngestOwnedGVRs()
	for _, action := range client.Actions() {
		if _, cut := owned[action.GetResource()]; !cut {
			continue
		}
		// Full Helm release objects intentionally use a separate filtered source.
		var selector string
		switch action := action.(type) {
		case clienttesting.ListAction:
			selector = action.GetListRestrictions().Labels.String()
		case clienttesting.WatchAction:
			selector = action.GetWatchRestrictions().Labels.String()
		default:
			continue
		}
		require.Contains(t, []string{"secrets", "configmaps"}, action.GetResource().Resource,
			"stream registration recreated an ingest-owned watch: %s", action.GetResource())
		require.Equal(t, "owner=helm", selector)
	}
}

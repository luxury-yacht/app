package objectcatalog

import (
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/client-go/kubernetes/fake"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
	gatewayfake "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned/fake"
	gatewayscheme "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned/scheme"
)

// everyGatewayKind is a cluster that serves every Gateway API kind.
type everyGatewayKind struct{}

func (everyGatewayKind) Has(string) bool { return true }

// Every Gateway API kind reaches the catalog through its owned ingest store:
// an add, an update, and a delete each show up in catalog queries. Adding a
// Gateway kind to the registry automatically exercises this contract.
func TestGatewayChangesReachCatalogThroughIngest(t *testing.T) {
	for _, spec := range kindregistry.All {
		identity := spec.Identity
		if identity.Group != gatewayv1.GroupName {
			continue
		}
		t.Run(identity.Kind, func(t *testing.T) {
			gvr := identity.GVR()
			mgr := ingest.NewIngestManager(streamrows.ClusterMeta{ClusterID: "c1"}, fake.NewClientset(), nil,
				&ingest.GatewaySource{Client: gatewayfake.NewSimpleClientset(), Presence: everyGatewayKind{}}) //nolint:staticcheck // no reflector runs
			require.True(t, mgr.RegisterCatalogProjector(gvr, SummaryProjector("c1", identity)))
			store := mgr.StoreFor(gvr)
			require.NotNil(t, store)
			store.MarkSynced()

			obj, err := gatewayscheme.Scheme.New(gvr.GroupVersion().WithKind(identity.Kind))
			require.NoError(t, err)
			metadata, err := meta.Accessor(obj)
			require.NoError(t, err)
			metadata.SetName("sample")
			metadata.SetUID("sample-uid")
			metadata.SetResourceVersion("1")
			if identity.Namespaced {
				metadata.SetNamespace("team-a")
			}

			svc := newTestWatchService()
			svc.clusterID = "c1" // the cluster the ingest rows are stamped with
			svc.deps.IngestSource = mgr
			desc := Descriptor{Group: gvr.Group, Version: gvr.Version, Resource: gvr.Resource, Kind: identity.Kind, Namespaced: identity.Namespaced, Scope: ScopeNamespace}
			if !desc.Namespaced {
				desc.Scope = ScopeCluster
			}
			registerDesc(svc, desc)
			notifier := newWatchNotifier(svc)
			registerWatchHandlers(notifier, svc)
			defer notifier.removeHandlers()

			require.NoError(t, store.Add(obj))
			require.Eventually(t, func() bool { return svc.Query(QueryOptions{}).TotalItems == 1 }, time.Second, time.Millisecond)
			updated := obj.DeepCopyObject()
			updatedMeta, _ := meta.Accessor(updated)
			updatedMeta.SetResourceVersion("2")
			require.NoError(t, store.Update(updated))
			require.Eventually(t, func() bool {
				items := svc.Query(QueryOptions{}).Items
				return len(items) == 1 && items[0].ResourceVersion == "2"
			}, time.Second, time.Millisecond)
			require.NoError(t, store.Delete(updated))
			require.Eventually(t, func() bool { return svc.Query(QueryOptions{}).TotalItems == 0 }, time.Second, time.Millisecond)
		})
	}
}

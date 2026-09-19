package objectcatalog

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/kindspec"
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	clientfeatures "k8s.io/client-go/features"
	clientfeaturestesting "k8s.io/client-go/features/testing"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes/fake"
	gatewayfake "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned/fake"
	gatewayscheme "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned/scheme"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"
)

// Every Gateway catalog collection source must also deliver changes to catalog
// consumers; adding a kind to the registry automatically exercises this contract.
func TestGatewayInformerChangesUpdateCatalog(t *testing.T) {
	clientfeaturestesting.SetFeatureDuringTest(t, clientfeatures.WatchListClient, false)
	for _, spec := range kindregistry.All {
		if spec.CatalogSource != kindspec.CatalogGateway {
			continue
		}
		t.Run(spec.Identity.Kind, func(t *testing.T) {
			identity := spec.Identity
			gvr := gatewayInformerGroupResources[schema.GroupResource{Group: identity.Group, Resource: identity.Resource}]
			obj, err := gatewayscheme.Scheme.New(gvr.GroupVersion().WithKind(identity.Kind))
			require.NoError(t, err)
			obj.GetObjectKind().SetGroupVersionKind(gvr.GroupVersion().WithKind(identity.Kind))
			metadata, err := meta.Accessor(obj)
			require.NoError(t, err)
			metadata.SetName("sample")
			metadata.SetUID("sample-uid")
			metadata.SetResourceVersion("1")
			if identity.Kind != "GatewayClass" {
				metadata.SetNamespace("team-a")
			}
			client := gatewayfake.NewSimpleClientset()
			require.NoError(t, client.Tracker().Create(gvr, obj, metadata.GetNamespace()))
			factory := gatewayinformers.NewSharedInformerFactory(client, 0)
			svc := newTestWatchService()
			svc.deps.GatewayInformerFactory = factory
			desc := Descriptor{Group: gvr.Group, Version: gvr.Version, Resource: gvr.Resource, Kind: identity.Kind, Namespaced: metadata.GetNamespace() != "", Scope: ScopeNamespace}
			if !desc.Namespaced {
				desc.Scope = ScopeCluster
			}
			registerDesc(svc, desc)
			// The collection creates this informer before reactive handlers attach.
			_, err = factory.ForResource(gvr)
			require.NoError(t, err)
			notifier := newWatchNotifier(svc)
			registerWatchHandlers(informers.NewSharedInformerFactory(fake.NewClientset(), 0), nil, notifier, svc)
			defer notifier.removeHandlers()
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			go notifier.run(ctx)
			factory.Start(ctx.Done())
			for _, synced := range factory.WaitForCacheSync(ctx.Done()) {
				require.True(t, synced)
			}
			require.Eventually(t, func() bool { return svc.Query(QueryOptions{}).TotalItems == 1 }, time.Second, time.Millisecond)
			updated := obj.DeepCopyObject()
			updatedMeta, _ := meta.Accessor(updated)
			updatedMeta.SetResourceVersion("2")
			require.NoError(t, client.Tracker().Update(gvr, updated, metadata.GetNamespace()))
			require.Eventually(t, func() bool { return svc.Query(QueryOptions{}).Items[0].ResourceVersion == "2" }, time.Second, time.Millisecond)
			require.NoError(t, client.Tracker().Delete(gvr, metadata.GetNamespace(), metadata.GetName(), metav1.DeleteOptions{}))
			require.Eventually(t, func() bool { return svc.Query(QueryOptions{}).TotalItems == 0 }, time.Second, time.Millisecond)
		})
	}
}

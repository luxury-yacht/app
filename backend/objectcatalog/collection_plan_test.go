package objectcatalog

import (
	"testing"

	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func TestCollectionSourcePlanCoversInformerRegistries(t *testing.T) {
	for gr := range sharedInformerListers {
		plan := planCollectionSourceForGroupResource(gr)
		require.Equalf(t, collectionSourceSharedInformer, plan.source, "%s should use shared informer", gr.String())
		require.Falsef(t, plan.promotable, "%s informer-backed source should not promote dynamic informer", gr.String())
	}

	for gr := range gatewayInformerListers {
		plan := planCollectionSourceForGroupResource(gr)
		require.Equalf(t, collectionSourceGatewayInformer, plan.source, "%s should use Gateway informer", gr.String())
		require.Falsef(t, plan.promotable, "%s informer-backed source should not promote dynamic informer", gr.String())
	}

	for gr := range watchInformerAccessor {
		plan := planCollectionSourceForGroupResource(gr)
		require.Truef(t, plan.watchable, "%s watch handler must be declared in the collection plan", gr.String())
		require.Equalf(t, collectionSourceSharedInformer, plan.source, "%s watch handler must match shared informer collection", gr.String())
	}
}

func TestCollectionSourcePlanDocumentsSpecialCases(t *testing.T) {
	endpoints := planCollectionSourceForGroupResource(schema.GroupResource{Group: "", Resource: "endpoints"})
	require.Equal(t, collectionSourceSkip, endpoints.source)
	require.False(t, endpoints.watchable)
	require.False(t, endpoints.promotable)

	crds := planCollectionSourceForGroupResource(schema.GroupResource{
		Group:    "apiextensions.k8s.io",
		Resource: "customresourcedefinitions",
	})
	require.Equal(t, collectionSourceAPIExtensionsInformer, crds.source)
	require.True(t, crds.watchable)
	require.False(t, crds.promotable)

	unknown := planCollectionSourceForGroupResource(schema.GroupResource{
		Group:    "example.com",
		Resource: "widgets",
	})
	require.Equal(t, collectionSourceDynamicList, unknown.source)
	require.False(t, unknown.watchable)
	require.True(t, unknown.promotable)
}

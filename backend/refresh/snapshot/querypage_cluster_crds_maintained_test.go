package snapshot

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	apiextv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apiextlisters "k8s.io/apiextensions-apiserver/pkg/client/listers/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/resources/apiextensions"
)

func crdForMaintained(name, group, scope, rv string) *apiextv1.CustomResourceDefinition {
	return &apiextv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: name, ResourceVersion: rv},
		Spec: apiextv1.CustomResourceDefinitionSpec{
			Group: group,
			Scope: apiextv1.ResourceScope(scope),
			Names: apiextv1.CustomResourceDefinitionNames{Kind: "Widget", Plural: "widgets"},
			Versions: []apiextv1.CustomResourceDefinitionVersion{
				{Name: "v1", Served: true, Storage: true},
				{Name: "v1beta1", Served: true},
			},
		},
	}
}

// TestClusterCRDBuilderMaintainedMatchesListPath is the cluster-crds maintained-store
// cutover gate: a builder serving from the informer-fed maintained store must produce the
// byte-identical ClusterCRDSnapshot the list path produces, across window + query scopes
// (sort, search, kind filter). The maintained path differs only in row SOURCE.
func TestClusterCRDBuilderMaintainedMatchesListPath(t *testing.T) {
	// Empty meta on both sides: the list path projects rows with the (empty) context
	// meta, so the maintained store must be fed with the same meta for byte-equivalence.
	meta := ClusterMeta{}
	crds := []*apiextv1.CustomResourceDefinition{
		crdForMaintained("widgets.example.com", "example.com", "Namespaced", "3"),
		crdForMaintained("gadgets.acme.io", "acme.io", "Cluster", "5"),
		crdForMaintained("sprockets.example.com", "example.com", "Namespaced", "4"),
	}

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{})
	maintained := newTypedMaintainedStore(meta, crdsQuerypageSchema(), clusterCRDTableQueryAdapter())
	for _, c := range crds {
		require.NoError(t, indexer.Add(c))
		maintained.upsertRow(apiextensions.BuildStreamSummary(meta, c), c)
	}
	listBuilder := &ClusterCRDBuilder{crdLister: apiextlisters.NewCustomResourceDefinitionLister(indexer)}
	maintainedBuilder := &ClusterCRDBuilder{maintained: maintained}

	scopes := []string{
		"",
		"cluster-a|?limit=2&sortField=name&sortDirection=asc",
		"cluster-a|?limit=50&sortField=group&sortDirection=desc",
		"cluster-a|?search=widget",
		"cluster-a|?kinds=CustomResourceDefinition",
	}
	for _, scope := range scopes {
		listSnap, err := listBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "list build %q", scope)
		maintSnap, err := maintainedBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "maintained build %q", scope)

		require.Equal(t,
			listSnap.Payload.(ClusterCRDSnapshot),
			maintSnap.Payload.(ClusterCRDSnapshot),
			"scope %q: maintained Build payload must equal the list Build payload", scope)
		require.Equal(t, listSnap.Version, maintSnap.Version, "scope %q: version", scope)
	}
}

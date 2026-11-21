package snapshot

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
)

// fakeAPIResourceSource stands in for the object catalog's discovered API surface.
type fakeAPIResourceSource struct {
	resources []objectcatalog.APIResource
	// ready flips from another goroutine when a test completes discovery late.
	ready   atomic.Bool
	updates chan objectcatalog.SubsetUpdate
}

func (f *fakeAPIResourceSource) APIResources() ([]objectcatalog.APIResource, uint64, bool) {
	return f.resources, 7, f.ready.Load()
}

func (f *fakeAPIResourceSource) SubscribeAPIResources() (<-chan objectcatalog.SubsetUpdate, func()) {
	return f.updates, func() {}
}

func apiResourceTestSource() *fakeAPIResourceSource {
	verbs := []string{"create", "delete", "get", "list", "patch", "update", "watch"}
	source := &fakeAPIResourceSource{
		updates: make(chan objectcatalog.SubsetUpdate, 1),
		resources: []objectcatalog.APIResource{
			{Group: "", Version: "v1", Versions: []string{"v1"}, Kind: "Pod", Resource: "pods", Singular: "pod", Namespaced: true, ShortNames: []string{"po"}, Categories: []string{"all"}, Verbs: verbs},
			{Group: "", Version: "v1", Versions: []string{"v1"}, Kind: "Node", Resource: "nodes", ShortNames: []string{"no"}, Verbs: verbs},
			{Group: "autoscaling", Version: "v2", Versions: []string{"v2", "v1"}, Kind: "HorizontalPodAutoscaler", Resource: "horizontalpodautoscalers", Namespaced: true, ShortNames: []string{"hpa"}, Verbs: verbs},
			{Group: "cert-manager.io", Version: "v1", Versions: []string{"v1"}, Kind: "Certificate", Resource: "certificates", Namespaced: true, ShortNames: []string{"cert", "certs"}, Verbs: verbs, Custom: true},
			{Group: "cert-manager.io", Version: "v1", Versions: []string{"v1"}, Kind: "ClusterIssuer", Resource: "clusterissuers", Verbs: verbs, Custom: true},
		},
	}
	source.ready.Store(true)
	return source
}

func apiResourceTestBuilder(source *fakeAPIResourceSource) *ClusterAPIResourcesBuilder {
	return &ClusterAPIResourcesBuilder{
		source:            func() APIResourceSource { return source },
		definitionsDenied: func() bool { return false },
		discoveryWait:     10 * time.Millisecond,
	}
}

func apiResourceTestBuild(t *testing.T, b *ClusterAPIResourcesBuilder, scope string) ClusterAPIResourcesSnapshot {
	t.Helper()
	result, err := b.Build(WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"}), "cluster-a|"+scope)
	require.NoError(t, err)
	return result.Payload.(ClusterAPIResourcesSnapshot)
}

func apiResourceRowKinds(rows []ClusterAPIResourceEntry) []string {
	kinds := make([]string, 0, len(rows))
	for _, row := range rows {
		kinds = append(kinds, row.Kind)
	}
	return kinds
}

// The table is the app's `kubectl api-resources`: one row per kind with the
// identity needed to open it. A custom kind opens its CustomResourceDefinition.
func TestClusterAPIResourcesDescribesEveryKind(t *testing.T) {
	payload := apiResourceTestBuild(t, apiResourceTestBuilder(apiResourceTestSource()), "?limit=100&sort=kind&sortDirection=asc")

	require.Equal(t, []string{"Certificate", "ClusterIssuer", "HorizontalPodAutoscaler", "Node", "Pod"}, apiResourceRowKinds(payload.Rows))
	require.Equal(t, 5, payload.Total)

	certificate := payload.Rows[0]
	require.Equal(t, ClusterAPIResourceEntry{
		ClusterID: "cluster-a", Kind: "Certificate", Group: "cert-manager.io", Version: "v1", APIVersion: "cert-manager.io/v1",
		Versions: []string{"v1"}, Resource: "certificates", Scope: "Namespaced", ShortNames: []string{"cert", "certs"},
		Verbs: []string{"create", "delete", "get", "list", "patch", "update", "watch"}, Categories: []string{}, Type: "Custom",
		Definition: &resourcemodel.ResourceRef{
			ClusterID: "cluster-a", Group: "apiextensions.k8s.io", Version: "v1", Kind: "CustomResourceDefinition",
			Resource: "customresourcedefinitions", Name: "certificates.cert-manager.io",
		},
	}, certificate)

	pod := payload.Rows[4]
	require.Equal(t, "v1", pod.APIVersion)
	require.Equal(t, "Namespaced", pod.Scope)
	require.Equal(t, "Built-in", pod.Type)
	require.Nil(t, pod.Definition)
	require.Equal(t, []string{"all"}, pod.Categories)

	hpa := payload.Rows[2]
	require.Equal(t, "autoscaling/v2", hpa.APIVersion)
	require.Equal(t, []string{"v2", "v1"}, hpa.Versions)
	require.Equal(t, "Cluster", payload.Rows[3].Scope)
}

func TestClusterAPIResourcesFiltersByTypeScopeAndSearch(t *testing.T) {
	b := apiResourceTestBuilder(apiResourceTestSource())

	custom := apiResourceTestBuild(t, b, "?limit=100&sort=kind&facet.types=Custom")
	require.Equal(t, []string{"Certificate", "ClusterIssuer"}, apiResourceRowKinds(custom.Rows))
	require.Equal(t, 5, custom.UnfilteredTotal)

	clusterScoped := apiResourceTestBuild(t, b, "?limit=100&sort=kind&facet.scopes=Cluster")
	require.Equal(t, []string{"ClusterIssuer", "Node"}, apiResourceRowKinds(clusterScoped.Rows))

	// A short name finds its kind, as `kubectl get hpa` users expect.
	byShortName := apiResourceTestBuild(t, b, "?limit=100&search=hpa")
	require.Equal(t, []string{"HorizontalPodAutoscaler"}, apiResourceRowKinds(byShortName.Rows))

	byGroup := apiResourceTestBuild(t, b, "?limit=100&sort=kind&search=cert-manager")
	require.Equal(t, []string{"Certificate", "ClusterIssuer"}, apiResourceRowKinds(byGroup.Rows))

	facetKeys := make([]string, 0)
	for _, facet := range custom.Capabilities.QueryFacets {
		facetKeys = append(facetKeys, facet.Key)
	}
	require.Equal(t, []string{"types", "scopes"}, facetKeys)
}

// The kind panel reads one row by its resource identity, the way the identity
// panel reads one subject.
func TestClusterAPIResourcesSelectsOneResource(t *testing.T) {
	payload := apiResourceTestBuild(t, apiResourceTestBuilder(apiResourceTestSource()),
		"?limit=1&predicate.resource=horizontalpodautoscalers.autoscaling")
	require.Equal(t, []string{"HorizontalPodAutoscaler"}, apiResourceRowKinds(payload.Rows))

	core := apiResourceTestBuild(t, apiResourceTestBuilder(apiResourceTestSource()), "?limit=1&predicate.resource=pods")
	require.Equal(t, []string{"Pod"}, apiResourceRowKinds(core.Rows))
}

// Without access to CustomResourceDefinitions the app cannot tell custom kinds
// from built-in ones; it must say so instead of labelling everything built-in.
func TestClusterAPIResourcesReportsUnknownTypesWhenDefinitionsAreDenied(t *testing.T) {
	source := apiResourceTestSource()
	for i := range source.resources {
		source.resources[i].Custom = false
	}
	b := apiResourceTestBuilder(source)
	b.definitionsDenied = func() bool { return true }

	payload := apiResourceTestBuild(t, b, "?limit=100")

	for _, row := range payload.Rows {
		require.Empty(t, row.Type)
		require.Nil(t, row.Definition)
	}
	require.Equal(t, ResourceQueryPartial, payload.Completeness)
	require.Len(t, payload.Issues, 1)
	require.Equal(t, "CustomResourceDefinition", payload.Issues[0].Kind)
}

// A view opened before the cluster's first discovery waits for it rather than
// rendering an empty table.
func TestClusterAPIResourcesWaitsForTheFirstDiscovery(t *testing.T) {
	source := apiResourceTestSource()
	source.ready.Store(false)
	b := apiResourceTestBuilder(source)
	b.discoveryWait = time.Second
	go func() {
		time.Sleep(20 * time.Millisecond)
		source.ready.Store(true)
		source.updates <- objectcatalog.SubsetUpdate{Revision: 7}
	}()

	payload := apiResourceTestBuild(t, b, "?limit=100")

	require.Len(t, payload.Rows, 5)
}

func TestClusterAPIResourcesFailsAsNotReadyWhenDiscoveryNeverCompletes(t *testing.T) {
	source := apiResourceTestSource()
	source.ready.Store(false)

	_, err := apiResourceTestBuilder(source).Build(
		WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"}), "cluster-a|?limit=100")

	require.Error(t, err)
	require.Equal(t, errorstatus.ReasonClusterNotReady, errorstatus.Classify(err).Reason)
}

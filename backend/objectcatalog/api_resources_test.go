package objectcatalog

import (
	"context"
	"testing"

	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
)

// groupedDiscovery serves a fixed groups-and-resources document, the single
// discovery call the catalog makes.
type groupedDiscovery struct {
	discovery.DiscoveryInterface
	groups []*metav1.APIGroup
	lists  []*metav1.APIResourceList
	err    error
}

func (d *groupedDiscovery) ServerGroupsAndResources() ([]*metav1.APIGroup, []*metav1.APIResourceList, error) {
	return d.groups, d.lists, d.err
}

func apiGroup(name, preferred string, versions ...string) *metav1.APIGroup {
	discoveryVersion := func(version string) metav1.GroupVersionForDiscovery {
		return metav1.GroupVersionForDiscovery{
			GroupVersion: metav1.GroupVersion{Group: name, Version: version}.String(),
			Version:      version,
		}
	}
	group := &metav1.APIGroup{Name: name, PreferredVersion: discoveryVersion(preferred)}
	for _, version := range versions {
		group.Versions = append(group.Versions, discoveryVersion(version))
	}
	return group
}

// groupsForLists derives the group document a server would publish alongside
// lists: each group's versions in list order, the first one preferred.
func groupsForLists(lists []*metav1.APIResourceList) []*metav1.APIGroup {
	var groups []*metav1.APIGroup
	byName := make(map[string]*metav1.APIGroup)
	for _, list := range lists {
		groupVersion, err := schema.ParseGroupVersion(list.GroupVersion)
		if err != nil {
			continue
		}
		group, ok := byName[groupVersion.Group]
		if !ok {
			group = apiGroup(groupVersion.Group, groupVersion.Version)
			byName[groupVersion.Group] = group
			groups = append(groups, group)
		}
		group.Versions = append(group.Versions, metav1.GroupVersionForDiscovery{
			GroupVersion: list.GroupVersion,
			Version:      groupVersion.Version,
		})
	}
	return groups
}

var allVerbs = []string{"create", "delete", "get", "list", "patch", "update", "watch"}

func multiVersionDiscovery() *groupedDiscovery {
	return &groupedDiscovery{
		groups: []*metav1.APIGroup{
			apiGroup("", "v1", "v1"),
			// The server lists the older version first; v2 is preferred.
			apiGroup("autoscaling", "v2", "v1", "v2"),
			apiGroup("example.io", "v1", "v1", "v1beta1"),
			apiGroup("metrics.k8s.io", "v1beta1", "v1beta1"),
		},
		lists: []*metav1.APIResourceList{
			{GroupVersion: "example.io/v1beta1", APIResources: []metav1.APIResource{
				{Name: "widgets", SingularName: "widget", Kind: "Widget", Namespaced: true, Verbs: []string{"get", "list"}},
				{Name: "relics", SingularName: "relic", Kind: "Relic", Verbs: allVerbs},
			}},
			{GroupVersion: "v1", APIResources: []metav1.APIResource{
				{Name: "pods", SingularName: "pod", Kind: "Pod", Namespaced: true, ShortNames: []string{"po"}, Categories: []string{"all"}, Verbs: allVerbs},
				{Name: "pods/log", Kind: "Pod", Namespaced: true, Verbs: []string{"get"}},
				{Name: "bindings", SingularName: "binding", Kind: "Binding", Namespaced: true, Verbs: []string{"create"}},
				{Name: "events", SingularName: "event", Kind: "Event", Namespaced: true, ShortNames: []string{"ev"}, Verbs: allVerbs},
			}},
			{GroupVersion: "autoscaling/v1", APIResources: []metav1.APIResource{
				{Name: "horizontalpodautoscalers", Kind: "HorizontalPodAutoscaler", Namespaced: true, ShortNames: []string{"hpa-old"}, Verbs: []string{"get"}},
			}},
			{GroupVersion: "autoscaling/v2", APIResources: []metav1.APIResource{
				{Name: "horizontalpodautoscalers", SingularName: "horizontalpodautoscaler", Kind: "HorizontalPodAutoscaler", Namespaced: true, ShortNames: []string{"hpa"}, Verbs: allVerbs},
			}},
			{GroupVersion: "example.io/v1", APIResources: []metav1.APIResource{
				{Name: "widgets", SingularName: "widget", Kind: "Widget", Namespaced: true, ShortNames: []string{"wd"}, Verbs: allVerbs},
			}},
			{GroupVersion: "metrics.k8s.io/v1beta1", APIResources: []metav1.APIResource{
				{Name: "nodes", Kind: "NodeMetrics", Verbs: []string{"get", "list"}},
			}},
		},
	}
}

func apiResourceByName(t *testing.T, resources []APIResource, group, resource string) APIResource {
	t.Helper()
	for _, candidate := range resources {
		if candidate.Group == group && candidate.Resource == resource {
			return candidate
		}
	}
	t.Fatalf("API resource %s/%s not found in %+v", group, resource, resources)
	return APIResource{}
}

// A kind the server no longer serves at the preferred version, a kind that
// cannot be listed, and Events must all be described, because the API Resources
// table documents the API surface rather than the objects the catalog collects.
func TestBuildAPIResourcesDescribesEveryServedKindOnce(t *testing.T) {
	source := multiVersionDiscovery()

	resources := buildAPIResources(source.groups, source.lists)

	names := make([]string, 0, len(resources))
	for _, resource := range resources {
		names = append(names, resource.Group+"/"+resource.Resource)
	}
	require.ElementsMatch(t, []string{
		"/pods", "/bindings", "/events",
		"autoscaling/horizontalpodautoscalers",
		"example.io/widgets", "example.io/relics",
		"metrics.k8s.io/nodes",
	}, names)

	require.Equal(t, APIResource{
		Group: "autoscaling", Version: "v2", Versions: []string{"v2", "v1"},
		Kind: "HorizontalPodAutoscaler", Resource: "horizontalpodautoscalers",
		Singular: "horizontalpodautoscaler", Namespaced: true,
		ShortNames: []string{"hpa"}, Verbs: allVerbs,
	}, apiResourceByName(t, resources, "autoscaling", "horizontalpodautoscalers"))

	// Served only by a non-preferred version: that version describes it.
	relic := apiResourceByName(t, resources, "example.io", "relics")
	require.Equal(t, "v1beta1", relic.Version)
	require.Equal(t, []string{"v1beta1"}, relic.Versions)
	require.False(t, relic.Namespaced)

	pod := apiResourceByName(t, resources, "", "pods")
	require.Equal(t, []string{"all"}, pod.Categories)
	require.Equal(t, []string{"po"}, pod.ShortNames)
}

// The catalog collects objects only for listable kinds at their preferred
// version, and never for Events, ComponentStatus, or the metrics API.
func TestDiscoverFromClientKeepsCatalogDescriptorsAtPreferredVersions(t *testing.T) {
	result, err := discoverFromClient(context.Background(), multiVersionDiscovery())
	require.NoError(t, err)

	require.ElementsMatch(t, []Descriptor{
		{Group: "", Version: "v1", Resource: "pods", Kind: "Pod", Scope: ScopeNamespace, Namespaced: true},
		{Group: "autoscaling", Version: "v2", Resource: "horizontalpodautoscalers", Kind: "HorizontalPodAutoscaler", Scope: ScopeNamespace, Namespaced: true},
		{Group: "example.io", Version: "v1", Resource: "widgets", Kind: "Widget", Scope: ScopeNamespace, Namespaced: true},
		{Group: "example.io", Version: "v1beta1", Resource: "relics", Kind: "Relic", Scope: ScopeCluster},
	}, result.descriptors)
	require.Len(t, result.apiResources, 7)
}

// Subscribers refetch the API Resources table on every signal, so an unchanged
// rediscovery must stay silent and a changed one must signal exactly once.
func TestServicePublishesAPIResourcesOnlyWhenDiscoveryChanges(t *testing.T) {
	source := multiVersionDiscovery()
	svc := &Service{clusterID: "c1", discoveryClient: source}

	_, _, ready := svc.APIResources()
	require.False(t, ready, "nothing is published before the first discovery")

	updates, cancel := svc.SubscribeAPIResources()
	defer cancel()

	_, err := svc.discoverResources(context.Background())
	require.NoError(t, err)
	first := requireAPIResourcesUpdate(t, updates)
	resources, revision, ready := svc.APIResources()
	require.True(t, ready)
	require.Equal(t, first.Revision, revision)
	require.Len(t, resources, 7)

	_, err = svc.discoverResources(context.Background())
	require.NoError(t, err)
	requireNoAPIResourcesUpdate(t, updates)

	source.lists = source.lists[:len(source.lists)-1]
	_, err = svc.discoverResources(context.Background())
	require.NoError(t, err)
	second := requireAPIResourcesUpdate(t, updates)
	require.Greater(t, second.Revision, first.Revision)
	resources, _, _ = svc.APIResources()
	require.Len(t, resources, 6)
}

// A failed discovery keeps the last published API surface instead of emptying
// the table.
func TestServiceKeepsAPIResourcesWhenDiscoveryFails(t *testing.T) {
	source := multiVersionDiscovery()
	svc := &Service{clusterID: "c1", discoveryClient: source}
	_, err := svc.discoverResources(context.Background())
	require.NoError(t, err)

	source.groups, source.lists, source.err = nil, nil, context.DeadlineExceeded
	_, err = svc.discoverResources(context.Background())
	require.Error(t, err)

	resources, _, ready := svc.APIResources()
	require.True(t, ready)
	require.Len(t, resources, 7)
}

func requireAPIResourcesUpdate(t *testing.T, updates <-chan SubsetUpdate) SubsetUpdate {
	t.Helper()
	select {
	case update := <-updates:
		return update
	default:
		t.Fatal("expected an API resources update")
		return SubsetUpdate{}
	}
}

func requireNoAPIResourcesUpdate(t *testing.T, updates <-chan SubsetUpdate) {
	t.Helper()
	select {
	case update := <-updates:
		t.Fatalf("unexpected API resources update %+v", update)
	default:
	}
}

// A kind is custom when a CustomResourceDefinition defines it. The CRD list
// arrives independently of discovery (often after it), so the flag must follow
// the definitions and signal the table when it changes.
func TestAPIResourcesFlagKindsDefinedByCRDs(t *testing.T) {
	svc := newTestWatchService()
	svc.discoveryClient = multiVersionDiscovery()
	_, err := svc.discoverResources(context.Background())
	require.NoError(t, err)
	updates, cancel := svc.SubscribeAPIResources()
	defer cancel()
	requireAPIResourcesUpdate(t, updates)
	custom := func(group, resource string) bool {
		resources, _, _ := svc.APIResources()
		return apiResourceByName(t, resources, group, resource).Custom
	}
	require.False(t, custom("example.io", "widgets"))

	hook := newCRDDiscoveryHook(newWatchNotifier(svc))
	widgets := establishedWidgetDefinition()
	widgets.Spec.Group = "example.io"
	hook.UpsertBundle(crdBundle(widgets))

	requireAPIResourcesUpdate(t, updates)
	require.True(t, custom("example.io", "widgets"))
	require.False(t, custom("example.io", "relics"), "only the defined resource is custom")
	require.False(t, custom("", "pods"))

	// A status-only CRD update changes nothing the table shows.
	updated := widgets.DeepCopy()
	updated.ResourceVersion = "2"
	hook.UpsertBundle(crdBundle(updated))
	requireNoAPIResourcesUpdate(t, updates)

	// A rediscovery keeps the flag.
	_, err = svc.discoverResources(context.Background())
	require.NoError(t, err)
	requireNoAPIResourcesUpdate(t, updates)
	require.True(t, custom("example.io", "widgets"))

	hook.DeleteBundle(crdBundle(updated))
	requireAPIResourcesUpdate(t, updates)
	require.False(t, custom("example.io", "widgets"))
}

// A relist replaces the whole CRD set at once.
func TestAPIResourcesFollowARelistedCRDSet(t *testing.T) {
	svc := newTestWatchService()
	svc.discoveryClient = multiVersionDiscovery()
	_, err := svc.discoverResources(context.Background())
	require.NoError(t, err)
	hook := newCRDDiscoveryHook(newWatchNotifier(svc))
	widgets := establishedWidgetDefinition()
	widgets.Spec.Group = "example.io"
	relics := establishedWidgetDefinition()
	relics.UID = "relics"
	relics.Spec.Group = "example.io"
	relics.Spec.Names.Plural = "relics"

	hook.ReplaceBundles([]ingest.Bundle{crdBundle(widgets), crdBundle(relics)})
	hook.ReplaceBundles([]ingest.Bundle{crdBundle(relics)})

	resources, _, _ := svc.APIResources()
	require.False(t, apiResourceByName(t, resources, "example.io", "widgets").Custom)
	require.True(t, apiResourceByName(t, resources, "example.io", "relics").Custom)
}

package objectcatalog

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
	authorizationv1 "k8s.io/api/authorization/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	kubefake "k8s.io/client-go/kubernetes/fake"
	clienttesting "k8s.io/client-go/testing"
)

// groupedDiscovery serves a fixed groups-and-resources document, the single
// discovery call the catalog makes.
type groupedDiscovery struct {
	discovery.DiscoveryInterface
	groups []*metav1.APIGroup
	lists  []*metav1.APIResourceList
	err    error
	onRead func()
}

func (d *groupedDiscovery) ServerGroupsAndResources() ([]*metav1.APIGroup, []*metav1.APIResourceList, error) {
	if d.onRead != nil {
		d.onRead()
	}
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

	require.False(t, svc.APIResources().Ready, "nothing is published before the first discovery")

	updates, cancel := svc.SubscribeAPIResources()
	defer cancel()

	_, err := svc.discoverResources(context.Background())
	require.NoError(t, err)
	first := requireAPIResourcesUpdate(t, updates)
	inventory := svc.APIResources()
	require.True(t, inventory.Ready)
	require.Equal(t, first.Revision, inventory.Revision)
	require.Len(t, inventory.Resources, 7)

	_, err = svc.discoverResources(context.Background())
	require.NoError(t, err)
	requireNoAPIResourcesUpdate(t, updates)

	source.lists = source.lists[:len(source.lists)-1]
	_, err = svc.discoverResources(context.Background())
	require.NoError(t, err)
	second := requireAPIResourcesUpdate(t, updates)
	require.Greater(t, second.Revision, first.Revision)
	require.Len(t, svc.APIResources().Resources, 6)
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

	inventory := svc.APIResources()
	require.True(t, inventory.Ready)
	require.Len(t, inventory.Resources, 7)
}

// A discovery that fails outright keeps the last API surface, but the
// inventory must say it is not current, and tell its subscribers, until a
// discovery succeeds again.
func TestAFailedDiscoveryIsReportedUntilTheNextSuccess(t *testing.T) {
	source := multiVersionDiscovery()
	svc := &Service{clusterID: "c1", discoveryClient: source}
	_, err := svc.discoverResources(context.Background())
	require.NoError(t, err)
	updates, cancel := svc.SubscribeAPIResources()
	defer cancel()
	requireAPIResourcesUpdate(t, updates)

	working := *source
	source.groups, source.lists, source.err = nil, nil, errors.New("the server is currently unable to handle the request")
	_, err = svc.discoverResources(context.Background())
	require.Error(t, err)

	inventory := svc.APIResources()
	require.EqualError(t, inventory.DiscoveryFailure, "the server is currently unable to handle the request")
	require.Len(t, inventory.Resources, 7, "the last discovered kinds stay")
	requireAPIResourcesUpdate(t, updates)

	// A retry that fails again is not news, whatever its error says: network
	// errors carry a different local port on every attempt.
	source.err = errors.New("read tcp 10.0.0.5:51234->10.0.0.1:443: connection reset by peer")
	_, err = svc.discoverResources(context.Background())
	require.Error(t, err)
	requireNoAPIResourcesUpdate(t, updates)
	require.EqualError(t, svc.APIResources().DiscoveryFailure, "the server is currently unable to handle the request")

	*source = working
	_, err = svc.discoverResources(context.Background())
	require.NoError(t, err)
	require.NoError(t, svc.APIResources().DiscoveryFailure)
	requireAPIResourcesUpdate(t, updates)
}

// When the very first discovery fails there is nothing to show, but a table
// waiting for discovery must learn of it: the failure is published and
// signalled, and the first success after it is signalled too.
func TestAFailedFirstDiscoveryIsSignalled(t *testing.T) {
	source := multiVersionDiscovery()
	working := *source
	denied := apierrors.NewForbidden(schema.GroupResource{Resource: "apis"}, "", errors.New("discovery is forbidden"))
	source.groups, source.lists, source.err = nil, nil, denied
	svc := &Service{clusterID: "c1", discoveryClient: source}
	updates, cancel := svc.SubscribeAPIResources()
	defer cancel()

	_, err := svc.discoverResources(context.Background())
	require.Error(t, err)

	requireAPIResourcesUpdate(t, updates)
	inventory := svc.APIResources()
	require.False(t, inventory.Ready)
	require.ErrorIs(t, inventory.DiscoveryFailure, denied)

	// The definitions list arriving before any discovery succeeds is not news.
	svc.apiResources.markCustomWatchListed()
	requireNoAPIResourcesUpdate(t, updates)

	// Until a discovery succeeds there is nothing to show but the reason, so
	// it is the latest one: a denied attempt followed by an unreachable server
	// must not keep reading as a permission problem. A retry is not signalled.
	unreachable := errors.New("dial tcp 10.0.0.1:443: connect: connection refused")
	source.err = unreachable
	_, err = svc.discoverResources(context.Background())
	require.Error(t, err)
	require.ErrorIs(t, svc.APIResources().DiscoveryFailure, unreachable)
	requireNoAPIResourcesUpdate(t, updates)

	*source = working
	_, err = svc.discoverResources(context.Background())
	require.NoError(t, err)
	requireAPIResourcesUpdate(t, updates)
	require.True(t, svc.APIResources().Ready)
	require.NoError(t, svc.APIResources().DiscoveryFailure)
}

// A discovery interrupted because its run was cancelled (the cluster is being
// disconnected) says nothing about the cluster's API.
func TestACancelledDiscoveryIsNotReportedAsAFailure(t *testing.T) {
	source := multiVersionDiscovery()
	svc := &Service{clusterID: "c1", discoveryClient: source}
	_, err := svc.discoverResources(context.Background())
	require.NoError(t, err)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	source.groups, source.lists, source.err = nil, nil, context.Canceled
	_, err = svc.discoverResources(ctx)
	require.Error(t, err)

	require.NoError(t, svc.APIResources().DiscoveryFailure)
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
		return apiResourceByName(t, svc.APIResources().Resources, group, resource).Custom
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
	requireNoAPIResourcesUpdate(t, updates)
	require.True(t, custom("example.io", "widgets"))

	// The first discovery without widgets removes the row directly.
	withoutWidgets := multiVersionDiscovery()
	for _, list := range withoutWidgets.lists {
		list.APIResources = slices.DeleteFunc(list.APIResources, func(resource metav1.APIResource) bool {
			return resource.Name == "widgets"
		})
	}
	svc.discoveryClient = withoutWidgets
	_, err = svc.discoverResources(t.Context())
	require.NoError(t, err)
	requireAPIResourcesUpdate(t, updates)
	require.False(t, slices.ContainsFunc(svc.APIResources().Resources, func(resource APIResource) bool {
		return resource.Group == "example.io" && resource.Resource == "widgets"
	}))
}

// A relist updates the CRD set, and discovery publishes any removed flags.
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

	resources := svc.APIResources().Resources
	require.True(t, apiResourceByName(t, resources, "example.io", "widgets").Custom)

	// Partial discovery retains the group's old rows and their classification.
	svc.discoveryClient = partialDiscovery(schema.GroupVersion{Group: "example.io", Version: "v1"})
	_, err = svc.discoverResources(t.Context())
	require.NoError(t, err)
	require.True(t, apiResourceByName(t, svc.APIResources().Resources, "example.io", "widgets").Custom)

	// A complete discovery can publish a kind that is now served by another API.
	svc.discoveryClient = multiVersionDiscovery()
	_, err = svc.discoverResources(t.Context())
	require.NoError(t, err)
	resources = svc.APIResources().Resources
	require.False(t, apiResourceByName(t, resources, "example.io", "widgets").Custom)
	require.True(t, apiResourceByName(t, resources, "example.io", "relics").Custom)
}

func TestAPIResourcesKeepClassificationWhenAReadOverlapsADeletion(t *testing.T) {
	svc := newTestWatchService()
	discovery := multiVersionDiscovery()
	svc.discoveryClient = discovery
	_, err := svc.discoverResources(t.Context())
	require.NoError(t, err)

	hook := newCRDDiscoveryHook(newWatchNotifier(svc))
	definition := exampleWidgetDefinition()
	hook.ReplaceBundles([]ingest.Bundle{definition})

	// The response was requested before the deletion and still lists the kind.
	discovery.onRead = func() { hook.DeleteBundle(definition) }
	_, err = svc.discoverResources(t.Context())
	require.NoError(t, err)
	require.True(t, apiResourceByName(t, svc.APIResources().Resources, "example.io", "widgets").Custom)

	discovery.onRead = nil
	_, err = svc.discoverResources(t.Context())
	require.NoError(t, err)
	require.False(t, apiResourceByName(t, svc.APIResources().Resources, "example.io", "widgets").Custom)
}

// crdListSource is an ingest source whose CustomResourceDefinition store the
// test drives by hand. listed reports that the store's list has really been
// read; settled is the ingest layer's liveness answer, which is also true for a
// store that gave up waiting (degraded) without listing anything. The
// subscribed sink receives what the store would deliver.
type crdListSource struct {
	*controlledIngestSource
	listed   bool
	settled  bool
	replayed []ingest.Bundle
	sink     ingest.BundleSink
}

func (s *crdListSource) HasSyncedFor(schema.GroupVersionResource) bool {
	return s.listed || s.settled
}

func (s *crdListSource) PartitionReadinessFor(schema.GroupVersionResource) []ingest.PartitionReadiness {
	if s.listed {
		return []ingest.PartitionReadiness{{State: refresh.ResourceReadinessReady}}
	}
	if s.settled {
		return []ingest.PartitionReadiness{{State: refresh.ResourceReadinessDegraded}}
	}
	return []ingest.PartitionReadiness{{State: refresh.ResourceReadinessPending}}
}

// SubscribeBundleSink replays the store's current rows as upserts, as the
// ingest store does.
func (s *crdListSource) SubscribeBundleSink(_ schema.GroupVersionResource, sink ingest.BundleSink) func() {
	s.sink = sink
	for _, bundle := range s.replayed {
		sink.UpsertBundle(bundle)
	}
	return func() {}
}

func exampleWidgetDefinition() ingest.Bundle {
	widgets := establishedWidgetDefinition()
	widgets.Spec.Group = "example.io"
	return crdBundle(widgets)
}

// Discovery finishes before the CustomResourceDefinition list is read. Until it
// is, "not flagged custom" does not mean built-in, so the inventory must say
// the classification is unknown, and signal when it becomes known.
func TestAPIResourceClassificationIsUnknownUntilTheCRDListIsRead(t *testing.T) {
	source := &crdListSource{controlledIngestSource: &controlledIngestSource{}}
	svc := newTestWatchService()
	svc.deps.IngestSource = source
	svc.discoveryClient = multiVersionDiscovery()
	_, err := svc.discoverResources(context.Background())
	require.NoError(t, err)
	updates, cancel := svc.SubscribeAPIResources()
	defer cancel()
	requireAPIResourcesUpdate(t, updates)
	require.False(t, svc.APIResources().CustomKnown, "the CRD hook has not registered yet")

	// The hook registers while the CRD store is still listing.
	detach := svc.registerCRDDiscoveryHook(newWatchNotifier(svc))
	defer detach()
	require.False(t, svc.APIResources().CustomKnown, "an unsynced CRD store has not told us anything")
	requireNoAPIResourcesUpdate(t, updates)

	// The store's first list arrives as a relist.
	source.sink.(ingest.BundleReplacer).ReplaceBundles([]ingest.Bundle{exampleWidgetDefinition()})
	requireAPIResourcesUpdate(t, updates)
	inventory := svc.APIResources()
	require.True(t, inventory.CustomKnown)
	require.True(t, apiResourceByName(t, inventory.Resources, "example.io", "widgets").Custom)
}

// When the CRD store finished listing before the hook registers (the usual
// order: the initial catalog sync waits for it), the registration replay is the
// complete list, including the case of a cluster with no CRDs at all.
func TestAPIResourceClassificationIsKnownOnceASyncedCRDStoreIsReplayed(t *testing.T) {
	for name, replayed := range map[string][]ingest.Bundle{
		"with definitions": {exampleWidgetDefinition()},
		"with none":        nil,
	} {
		t.Run(name, func(t *testing.T) {
			source := &crdListSource{controlledIngestSource: &controlledIngestSource{}, listed: true, replayed: replayed}
			svc := newTestWatchService()
			svc.deps.IngestSource = source
			svc.discoveryClient = multiVersionDiscovery()
			_, err := svc.discoverResources(context.Background())
			require.NoError(t, err)

			detach := svc.registerCRDDiscoveryHook(newWatchNotifier(svc))
			defer detach()

			inventory := svc.APIResources()
			require.True(t, inventory.CustomKnown)
			require.Equal(t, len(replayed) > 0, apiResourceByName(t, inventory.Resources, "example.io", "widgets").Custom)
		})
	}
}

// The ingest layer stops waiting for a store that cannot finish its first list
// and calls it settled. Nothing was listed, so an empty replay must not be
// taken for "this cluster has no custom kinds".
func TestAPIResourceClassificationStaysUnknownForACRDStoreThatGaveUpListing(t *testing.T) {
	source := &crdListSource{controlledIngestSource: &controlledIngestSource{}, settled: true}
	svc := newTestWatchService()
	svc.deps.IngestSource = source
	svc.discoveryClient = multiVersionDiscovery()
	_, err := svc.discoverResources(context.Background())
	require.NoError(t, err)

	detach := svc.registerCRDDiscoveryHook(newWatchNotifier(svc))
	defer detach()
	require.False(t, svc.APIResources().CustomKnown)

	// The list finally arrives.
	source.sink.(ingest.BundleReplacer).ReplaceBundles([]ingest.Bundle{exampleWidgetDefinition()})
	require.True(t, svc.APIResources().CustomKnown)
}

func TestAPIResourceClassificationUsesListUntilACompleteWatchTakesOver(t *testing.T) {
	svc := newTestWatchService()
	svc.discoveryClient = multiVersionDiscovery()
	_, err := svc.discoverResources(t.Context())
	require.NoError(t, err)

	listed := []Summary{{Ref: resourcemodel.ResourceRef{
		ClusterID: svc.clusterID, Group: "apiextensions.k8s.io", Version: "v1",
		Kind: "CustomResourceDefinition", Resource: "customresourcedefinitions", Name: "widgets.example.io",
	}}}
	svc.apiResources.applyDefinitionList(listed, true, false)
	svc.apiResources.applyDefinitionList(nil, false, false)
	inventory := svc.APIResources()
	require.True(t, inventory.CustomKnown)
	require.True(t, apiResourceByName(t, inventory.Resources, "example.io", "widgets").Custom)

	// A LIST-only client also needs fresh discovery after a definition vanishes.
	svc.apiResources.applyDefinitionList(nil, true, false)
	require.True(t, apiResourceByName(t, svc.APIResources().Resources, "example.io", "widgets").Custom)
	invalidations := 0
	svc.discoveryInvalidate = func() { invalidations++ }
	_, err = svc.discoverResources(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, invalidations)
	require.False(t, apiResourceByName(t, svc.APIResources().Resources, "example.io", "widgets").Custom)

	svc.apiResources.applyDefinitionList(listed, true, false)
	svc.apiResources.applyDefinitionList(nil, false, true)
	inventory = svc.APIResources()
	require.False(t, inventory.CustomKnown)
	require.True(t, inventory.CustomListDenied)
	require.False(t, apiResourceByName(t, inventory.Resources, "example.io", "widgets").Custom)

	// The reflector recovers with an empty list. A slower catalog LIST cannot
	// bring a deleted definition back after the complete watch takes over.
	hook := newCRDDiscoveryHook(newWatchNotifier(svc))
	hook.ReplaceBundles(nil)
	svc.apiResources.applyDefinitionList(listed, true, false)
	inventory = svc.APIResources()
	require.True(t, inventory.CustomKnown)
	require.False(t, inventory.CustomListDenied)
	require.False(t, apiResourceByName(t, inventory.Resources, "example.io", "widgets").Custom)
}

// partialDiscovery fails one group version and serves the rest, as an API
// server does while an aggregated API is unavailable.
func partialDiscovery(failed schema.GroupVersion) *groupedDiscovery {
	source := multiVersionDiscovery()
	lists := source.lists[:0:0]
	for _, list := range source.lists {
		if list.GroupVersion != failed.String() {
			lists = append(lists, list)
		}
	}
	source.lists = lists
	source.err = &discovery.ErrGroupDiscoveryFailed{Groups: map[schema.GroupVersion]error{failed: context.DeadlineExceeded}}
	return source
}

// A group that is temporarily unreachable must not vanish from the table as if
// its kinds had been removed: its last known kinds stay, and the inventory
// names the group versions it could not read.
func TestPartialDiscoveryKeepsTheUnreachableGroupsKinds(t *testing.T) {
	metrics := schema.GroupVersion{Group: "metrics.k8s.io", Version: "v1beta1"}
	svc := &Service{clusterID: "c1", discoveryClient: multiVersionDiscovery()}
	_, err := svc.discoverResources(context.Background())
	require.NoError(t, err)
	require.Empty(t, svc.APIResources().FailedGroupVersions)

	svc.discoveryClient = partialDiscovery(metrics)
	_, err = svc.discoverResources(context.Background())
	require.NoError(t, err, "the reachable groups still discover")

	inventory := svc.APIResources()
	require.Equal(t, []string{"metrics.k8s.io/v1beta1"}, inventory.FailedGroupVersions)
	require.Len(t, inventory.Resources, 7)
	require.Equal(t, "NodeMetrics", apiResourceByName(t, inventory.Resources, "metrics.k8s.io", "nodes").Kind)

	// The group answers again: the failure clears.
	svc.discoveryClient = multiVersionDiscovery()
	_, err = svc.discoverResources(context.Background())
	require.NoError(t, err)
	require.Empty(t, svc.APIResources().FailedGroupVersions)
}

// One version of a group failing must not rewrite the group from its other
// versions: example.io/v1 is preferred, and losing it would re-describe
// widgets by v1beta1 until the next discovery.
func TestPartialDiscoveryKeepsAGroupWhoseOtherVersionsStillAnswer(t *testing.T) {
	svc := &Service{clusterID: "c1", discoveryClient: multiVersionDiscovery()}
	_, err := svc.discoverResources(context.Background())
	require.NoError(t, err)
	before := apiResourceByName(t, svc.APIResources().Resources, "example.io", "widgets")

	svc.discoveryClient = partialDiscovery(schema.GroupVersion{Group: "example.io", Version: "v1"})
	_, err = svc.discoverResources(context.Background())
	require.NoError(t, err)

	inventory := svc.APIResources()
	require.Equal(t, before, apiResourceByName(t, inventory.Resources, "example.io", "widgets"))
	require.Equal(t, []string{"example.io/v1"}, inventory.FailedGroupVersions)
}

// The first discovery of a session can be partial too: there is nothing to
// keep, but the table must still be told it is incomplete.
func TestAFirstPartialDiscoveryReportsTheUnreachableGroup(t *testing.T) {
	svc := &Service{clusterID: "c1", discoveryClient: partialDiscovery(schema.GroupVersion{Group: "metrics.k8s.io", Version: "v1beta1"})}
	_, err := svc.discoverResources(context.Background())
	require.NoError(t, err)

	inventory := svc.APIResources()
	require.True(t, inventory.Ready)
	require.Len(t, inventory.Resources, 6)
	require.Equal(t, []string{"metrics.k8s.io/v1beta1"}, inventory.FailedGroupVersions)
}

// The same contract through the production owners: a real ingest manager that
// lists CustomResourceDefinitions from an API server, and the catalog's own run
// loop registering the hook. A definition that exists before the catalog
// starts must end up classified, with the classification marked known.
func TestCatalogClassifiesCustomKindsFromTheRealCRDStore(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	kube := kubefake.NewClientset()
	kube.PrependReactor("create", "selfsubjectaccessreviews", func(action clienttesting.Action) (bool, runtime.Object, error) {
		review := action.(clienttesting.CreateAction).GetObject().(*authorizationv1.SelfSubjectAccessReview)
		review.Status.Allowed = true
		return true, review, nil
	})
	server, definitions := definitionIngest(t)
	server.Create(t, establishedWidgetDefinition())
	definitions.Start(ctx)
	t.Cleanup(definitions.Stop)
	require.Eventually(t, definitions.HasSynced, 5*time.Second, time.Millisecond)

	svc := NewService(Dependencies{
		Common:    common.Dependencies{KubernetesClient: kube, DynamicClient: widgetDynamicClient()},
		ClusterID: "c1", IngestSource: definitions,
	}, nil)
	svc.discoveryClient = &stubDiscovery{DiscoveryInterface: kube.Discovery(), lists: []*metav1.APIResourceList{
		{GroupVersion: "example.com/v1", APIResources: []metav1.APIResource{{Name: "widgets", Kind: "Widget", Namespaced: true, Verbs: []string{"list", "watch"}}}},
		{GroupVersion: "v1", APIResources: []metav1.APIResource{{Name: "pods", Kind: "Pod", Namespaced: true, Verbs: []string{"list", "watch"}}}},
	}}
	done := make(chan error, 1)
	go func() { done <- svc.Run(ctx) }()
	t.Cleanup(func() { cancel(); <-done })

	require.Eventually(t, func() bool { return svc.APIResources().CustomKnown }, 5*time.Second, time.Millisecond)
	inventory := svc.APIResources()
	require.True(t, apiResourceByName(t, inventory.Resources, "example.com", "widgets").Custom)
	require.False(t, apiResourceByName(t, inventory.Resources, "", "pods").Custom)
}

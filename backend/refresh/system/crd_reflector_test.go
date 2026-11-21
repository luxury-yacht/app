package system

import (
	"slices"
	"sort"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/ingest/ingesttest"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/resources/apiextensions"
	"github.com/stretchr/testify/require"
	authorizationv1 "k8s.io/api/authorization/v1"
	apiextv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	dynamicfake "k8s.io/client-go/dynamic/fake"
)

var (
	widgetsGVR = schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}
	gadgetsGVR = schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "gadgets"}
)

// servedDefinition is an established CRD serving gvr.
func servedDefinition(gvr schema.GroupVersionResource, kind string, uid types.UID) *apiextv1.CustomResourceDefinition {
	return &apiextv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: gvr.Resource + "." + gvr.Group, UID: uid},
		Spec: apiextv1.CustomResourceDefinitionSpec{
			Group: gvr.Group, Scope: apiextv1.NamespaceScoped,
			Names:    apiextv1.CustomResourceDefinitionNames{Plural: gvr.Resource, Kind: kind},
			Versions: []apiextv1.CustomResourceDefinitionVersion{{Name: gvr.Version, Served: true, Storage: true}},
		},
		Status: apiextv1.CustomResourceDefinitionStatus{Conditions: []apiextv1.CustomResourceDefinitionCondition{{Type: apiextv1.Established, Status: apiextv1.ConditionTrue}}},
	}
}

// withCustomResources gives the subsystem a dynamic client that lists the
// widgets and gadgets custom resources.
func withCustomResources(cfg *Config) {
	cfg.DynamicClient = dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), map[schema.GroupVersionResource]string{
		widgetsGVR: "WidgetList", gadgetsGVR: "GadgetList",
	})
}

// admitted waits until discovery's version of gvr has a running source.
func (h *reflectorHarness) admitted(t *testing.T, gvr schema.GroupVersionResource) uint64 {
	t.Helper()
	require.True(t, h.subsystem.IngestManager.ReconcileDiscoveredResource(gvr), "%s must be a known definition", gvr.Resource)
	require.Eventually(t, func() bool { return h.subsystem.IngestManager.HasSyncedFor(gvr) }, 5*time.Second, time.Millisecond)
	source, ok := h.subsystem.IngestManager.ReadDynamicCatalogSource(gvr.GroupResource())
	require.True(t, ok)
	return source.Generation
}

// definitions are the names of the CustomResourceDefinitions the CRD reflector
// holds.
func (h *reflectorHarness) definitions(t *testing.T) []string {
	t.Helper()
	store := h.subsystem.IngestManager.StoreFor(apiextensions.Identity.GVR())
	require.NotNil(t, store, "the subsystem must watch CustomResourceDefinitions")
	names := store.ListKeys()
	sort.Strings(names)
	return names
}

// awaitDefinitions waits until the CRD reflector holds exactly want.
func (h *reflectorHarness) awaitDefinitions(t *testing.T, want ...string) {
	t.Helper()
	require.Eventually(t, func() bool { return slices.Equal(h.definitions(t), want) }, 5*time.Second, 10*time.Millisecond)
}

// CustomResourceDefinitions have no table of their own, but the subsystem
// still watches them to feed the dynamic custom-resource sources: discovery
// admits a created CRD's source, and deleting the CRD retires it.
func TestCRDReflectorFeedsDynamicSources(t *testing.T) {
	server := newReflectorAPIServer(t)
	h := newReflectorHarness(t, server, "", withCustomResources)
	widgets := servedDefinition(widgetsGVR, "Widget", "widgets-a")

	server.Create(t, widgets)
	h.awaitDefinitions(t, "widgets.example.com")
	h.admitted(t, widgetsGVR)

	server.Delete(t, widgets)
	h.awaitDefinitions(t)
	require.Eventually(t, func() bool { return !h.subsystem.IngestManager.Tracks(widgetsGVR) }, 5*time.Second, time.Millisecond, "a deleted CRD retires its source")
}

// A relist after a watch gap omits a CRD deleted during the gap, with no
// delete event. Its source must still be retired, and a surviving source must
// be left running untouched. A CRD replaced by a new incarnation during the
// gap must have its source move to the new definition.
func TestCRDRelistRetiresDefinitionsChangedDuringAWatchGap(t *testing.T) {
	t.Run("deleted", func(t *testing.T) {
		server := newReflectorAPIServer(t)
		h := newReflectorHarness(t, server, "", withCustomResources)
		widgets := servedDefinition(widgetsGVR, "Widget", "widgets-a")
		gadgets := servedDefinition(gadgetsGVR, "Gadget", "gadgets-a")
		server.Create(t, widgets)
		server.Create(t, gadgets)
		h.awaitDefinitions(t, "gadgets.example.com", "widgets.example.com")
		generation := h.admitted(t, widgetsGVR)
		h.admitted(t, gadgetsGVR)

		server.WatchGap(t, func() { server.Delete(t, gadgets) })

		require.Eventually(t, func() bool { return !h.subsystem.IngestManager.Tracks(gadgetsGVR) }, 5*time.Second, time.Millisecond, "the relist must retire the deleted CRD's source")
		source, ok := h.subsystem.IngestManager.ReadDynamicCatalogSource(widgetsGVR.GroupResource())
		require.True(t, ok)
		require.Equal(t, generation, source.Generation, "the surviving source must not restart")
	})
	t.Run("replaced", func(t *testing.T) {
		server := newReflectorAPIServer(t)
		h := newReflectorHarness(t, server, "", withCustomResources)
		widgets := servedDefinition(widgetsGVR, "Widget", "widgets-a")
		server.Create(t, widgets)
		h.awaitDefinitions(t, "widgets.example.com")
		h.admitted(t, widgetsGVR)

		server.WatchGap(t, func() {
			server.Delete(t, widgets)
			server.Create(t, servedDefinition(widgetsGVR, "Widget", "widgets-b"))
		})

		require.Eventually(t, func() bool {
			source, ok := h.subsystem.IngestManager.ReadDynamicCatalogSource(widgetsGVR.GroupResource())
			return ok && source.Spec.DefinitionUID == "widgets-b"
		}, 5*time.Second, time.Millisecond, "the source must move to the new incarnation")
	})
}

// A re-warm resumes the CRD watch from its spilled resourceVersion with no CRD
// events (the CRD existed at the last list). Discovery must still find every
// restored definition and admit its source.
func TestCRDRewarmKeepsDefinitionsWithoutCRDChanges(t *testing.T) {
	server := newReflectorAPIServer(t)
	server.Create(t, servedDefinition(widgetsGVR, "Widget", "widgets-a"))
	before := newReflectorHarness(t, server, "", withCustomResources)
	before.awaitDefinitions(t, "widgets.example.com")
	spill := t.TempDir()
	require.NoError(t, before.subsystem.IngestManager.SpillStores(spill))
	before.stop()

	after := newReflectorHarness(t, server, spill, withCustomResources)
	after.admitted(t, widgetsGVR)
}

// No domain lists CustomResourceDefinitions, but the subsystem still watches
// them. An identity that cannot list them at connect gets no definitions; when
// that access is granted later the subsystem must notice, so its owner rebuilds
// the generation with the CRD reflector running.
func TestCRDAccessGrantedAfterConnectRequestsARebuild(t *testing.T) {
	server := ingesttest.NewAPIServer(t, reflectedBuiltinKinds...)
	server.Allow(func(attrs authorizationv1.ResourceAttributes) bool {
		return attrs.Group != "metrics.k8s.io" && attrs.Resource != apiextensions.Identity.Resource
	})
	h := newReflectorHarness(t, server, "")
	require.True(t, h.subsystem.IngestManager.PermissionSkippedFor(apiextensions.Identity.GVR()), "a denied CRD list skips the reflector")
	require.False(t, h.subsystem.permissionsChanged(t.Context()))

	server.Allow(func(attrs authorizationv1.ResourceAttributes) bool { return attrs.Group != "metrics.k8s.io" })
	// A fresh checker models the expired permission cache without waiting out its TTL.
	h.subsystem.RuntimePerms = permissions.NewChecker(server.Client(t), "c1", 0)

	require.True(t, h.subsystem.permissionsChanged(t.Context()), "restored CRD access must request a rebuild")
}

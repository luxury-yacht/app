package system

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
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

// The CRD reflector feeds the CRD table and the dynamic custom-resource
// sources: a created CRD's row appears through its doorbell, discovery admits
// its source, and deleting the CRD removes the row and retires the source.
func TestCRDReflectorFeedsTheTableAndDynamicSources(t *testing.T) {
	server := newReflectorAPIServer(t)
	h := newReflectorHarness(t, server, "", withCustomResources)
	table := h.subscribe(t, "cluster-crds", "")
	widgets := servedDefinition(widgetsGVR, "Widget", "widgets-a")

	server.Create(t, widgets)
	h.awaitRows(t, table, "cluster-crds", "", []string{"widgets.example.com"})
	h.admitted(t, widgetsGVR)

	server.Delete(t, widgets)
	h.awaitRows(t, table, "cluster-crds", "", []string{})
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
		require.Eventually(t, func() bool { return len(h.rowNames(t, "cluster-crds", "")) == 2 }, 5*time.Second, 10*time.Millisecond)
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
		require.Eventually(t, func() bool { return len(h.rowNames(t, "cluster-crds", "")) == 1 }, 5*time.Second, 10*time.Millisecond)
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
	require.Eventually(t, func() bool { return len(before.rowNames(t, "cluster-crds", "")) == 1 }, 5*time.Second, 10*time.Millisecond)
	spill := t.TempDir()
	require.NoError(t, before.subsystem.IngestManager.SpillStores(spill))
	before.stop()

	after := newReflectorHarness(t, server, spill, withCustomResources)
	after.admitted(t, widgetsGVR)
}

/*
 * backend/refresh/kindspec/descriptor.go
 *
 * The single per-kind Descriptor: a kind's identity plus every typed behaviour the
 * app needs from it (stream summary, object-map node + edges, detail binding) and
 * the facet flags that tell each subsystem how to treat it (catalog source,
 * detail-cache eviction). One registry (refresh/kindregistry) aggregates these;
 * every subsystem loops that registry and filters by facet, so no subsystem ever
 * names a kind itself.
 *
 * This package imports only leaves (resourcekind, streamspec, objectmapnode,
 * objectmapspec, appbinding + metav1) and NO kind packages, so a kind can declare
 * its Descriptor without an import cycle.
 */

package kindspec

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmapnode"
	"github.com/luxury-yacht/app/backend/refresh/objectmapspec"
	"github.com/luxury-yacht/app/backend/refresh/streamspec"
	"github.com/luxury-yacht/app/backend/resourcekind"
	"github.com/luxury-yacht/app/backend/resources/appbinding"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// CatalogSource names how the object catalog lists a kind's objects.
type CatalogSource int

const (
	// CatalogDynamic lists the kind via the dynamic client (no shared informer in
	// the catalog's collection plan). This is the default for kinds with no
	// dedicated informer wired into the catalog.
	CatalogDynamic CatalogSource = iota
	// CatalogShared lists the kind from the core shared informer factory.
	CatalogShared
	// CatalogGateway lists the kind from the Gateway-API informer factory.
	CatalogGateway
	// CatalogAPIExtensions lists the kind from the apiextensions informer factory.
	CatalogAPIExtensions
)

// Descriptor is the one place a kind hands the rest of the app everything it needs.
// Facet fields are nil/zero when the kind does not participate in that subsystem
// (e.g. Stream is nil for a kind that is not directly streamed). The catalog,
// resource-stream, snapshot, object-map, detail-binding, and cache-invalidation
// subsystems each read only the facets they care about.
type Descriptor struct {
	// Identity is the kind's canonical group/version/kind/resource. It is the
	// single source of identity; subsystems key informers and listers off it.
	Identity resourcekind.Identity

	// CatalogSource tells the object catalog which informer factory (or the dynamic
	// client) backs this kind's list/watch.
	CatalogSource CatalogSource

	// DetailCacheable marks kinds whose informer drives response-cache eviction of
	// cached detail/YAML/Helm responses. The factory is implied by the kind's group.
	DetailCacheable bool

	// Stream is the directly-streamed-table descriptor; nil when the kind is not
	// streamed via the generic descriptor dispatch (it streams via a bespoke path
	// or not at all).
	Stream *streamspec.Descriptor

	// Collector projects this kind into the object map from the shared informer
	// cache; nil when the kind has no shared-informer object-map node.
	Collector *objectmapnode.Collector

	// GatewayCollector projects a Gateway-API kind into the object map via the
	// Gateway client; nil for non-Gateway kinds.
	GatewayCollector *objectmapnode.GatewayCollector

	// Edges builds this kind's object-map relationship edges; nil when the kind
	// contributes no edges.
	Edges func(clusterID string, obj metav1.Object) []objectmapspec.Edge

	// Binding is the typed detail-service / app-binding spec; nil when the kind's
	// detail is served by a bespoke path (e.g. Pod, CustomResourceDefinition, Helm).
	Binding *appbinding.Spec
}

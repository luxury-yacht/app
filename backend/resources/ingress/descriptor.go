package ingress

import "github.com/luxury-yacht/app/backend/kind/kindspec"

// Descriptor(s) register ingress's kind(s) in the single kind registry
// (kind/kindregistry.All): the canonical Identity plus the facets every
// subsystem reads. This is the one place ingress hands itself to the app.

var Descriptor = kindspec.Descriptor{
	Identity:        Identity,
	CatalogSource:   kindspec.CatalogShared,
	DetailCacheable: true,
	// IngestOwned: the Ingress typed informer is never instantiated. Ingress is plain
	// object→row (no cross-kind join), so the generic ingest loop builds its reflector
	// from the Stream descriptor and feeds the namespace-network table + catalog +
	// object-map from the projected bundle, like configmap/storageclass.
	IngestOwned: true,
	Stream:      &StreamDescriptor,
	Collector:   &ObjectMapNode,
	Edges:       ObjectMapEdges,
	Binding:     &DetailBinding,
}

/*
 * backend/refresh/snapshot/network_ingest_source.go
 *
 * The two SERVE-TIME reads the namespace-network domain still makes from the ingest source
 * after the cut network kinds' OWN-rows (Service/EndpointSlice/Ingress/NetworkPolicy Table
 * halves) moved to the Sink-fed maintained store: (1) the EndpointSlice service-join — each
 * Service row's ready endpoint count, summed from the projected EndpointSlice store's join
 * facts (the Bundle Aggregate half, NOT delivered to the maintained store's Table-only Sink),
 * a cross-kind join re-applied at serve so the Service row stays byte-identical to the typed
 * service.BuildStreamSummary(meta, svc, slices); and (2) the version watermark — the highest
 * store RV across the cut kinds, folded into the snapshot version in place of the per-object
 * RV the dropped typed objects no longer carry.
 */

package snapshot

import (
	"strconv"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// networkIngestSource supplies the two serve-time ingest reads the namespace-network domain
// still makes (the EndpointSlice join facts and the cut kinds' store RVs). Rows returns each
// kind's per-object bundles in one consistent store read; StoreResourceVersion gives the
// store's latest list/watch RV for the version watermark. *ingest.IngestManager satisfies it.
type networkIngestSource interface {
	Rows(gvr schema.GroupVersionResource) []interface{}
	StoreResourceVersion(gvr schema.GroupVersionResource) string
}

// namespaceEndpointSliceReadyCounts reads the EndpointSlice store's projected Service-join
// facts (the Bundle Aggregate half) and sums each Service's ready endpoint-address count,
// keyed by the serviceSliceKey(namespace, serviceName). It is filtered to the namespace
// ("" = all namespaces) so a Service's count aggregates only same-namespace slices, exactly
// as groupEndpointSlicesByService did. A nil source yields an empty map; an orphan slice
// (no owning service) contributes to no key. The summed count equals service.ReadyEndpointCount
// over the Service's slices because the per-slice aggregation is independent and additive.
func namespaceEndpointSliceReadyCounts(source networkIngestSource, namespace string) map[string]int {
	counts := map[string]int{}
	if source == nil {
		return counts
	}
	for _, raw := range source.Rows(EndpointSliceGVR) {
		bundle, ok := raw.(ingest.Bundle)
		if !ok {
			continue
		}
		fact, ok := bundle.Aggregate.(streamrows.EndpointSliceServiceFact)
		if !ok || fact.ServiceName == "" {
			continue
		}
		if namespace != "" && fact.Namespace != namespace {
			continue
		}
		counts[serviceSliceKey(fact.Namespace, fact.ServiceName)] += fact.ReadyEndpointCount
	}
	return counts
}

// namespaceNetworkIngestVersion returns the highest store RV across the cut network kinds'
// stores as the version watermark contribution for a network build that reads through the
// ingest source. A nil source or unparseable RVs contribute 0.
func namespaceNetworkIngestVersion(source networkIngestSource, gvrs ...schema.GroupVersionResource) uint64 {
	if source == nil {
		return 0
	}
	var max uint64
	for _, gvr := range gvrs {
		rv := source.StoreResourceVersion(gvr)
		if rv == "" {
			continue
		}
		parsed, err := strconv.ParseUint(rv, 10, 64)
		if err != nil {
			continue
		}
		if parsed > max {
			max = parsed
		}
	}
	return max
}

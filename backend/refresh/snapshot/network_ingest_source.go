/*
 * backend/refresh/snapshot/network_ingest_source.go
 *
 * The network read path for the namespace-network domain after the network cut.
 * Service, EndpointSlice, Ingress, and NetworkPolicy are owned-reflector ingest kinds: the
 * shared factory no longer caches the typed objects, so the network domain reads each
 * kind's projected NetworkSummary (the Bundle Table half) the reflector built at intake,
 * keyed off each kind's GVR, instead of a typed lister. Service rows are OWN-fields only
 * (built with nil slices); the serve path re-joins the endpoint count from the projected
 * EndpointSlice store's join facts (the Bundle Aggregate half), reproducing the pre-cut
 * Service row byte for byte.
 *
 * Each kind's per-object Table half also carries the object's resourceVersion through the
 * ingest store's watermark, so the domain folds the store RV into its version watermark in
 * place of the per-object RV it can no longer read from the dropped typed objects.
 */

package snapshot

import (
	"strconv"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// networkIngestSource supplies the cut network kinds' projected rows the namespace-network
// domain reads. Rows returns each kind's per-object bundles in one consistent store read;
// StoreResourceVersion gives the store's latest list/watch RV for the version watermark.
// *ingest.IngestManager satisfies it.
type networkIngestSource interface {
	Rows(gvr schema.GroupVersionResource) []interface{}
	StoreResourceVersion(gvr schema.GroupVersionResource) string
}

// namespaceNetworkOwnRows reads a cut network kind's projected Table-half NetworkSummary
// rows from the ingest source for the given GVR, filtered to the namespace ("" = all
// namespaces). A nil source yields no rows; a row of the wrong type is skipped, mirroring
// the type guards the ingest sinks apply. For Service these are the OWN-fields rows the
// serve path re-joins endpoint counts onto; for EndpointSlice/Ingress/NetworkPolicy they
// are the full rows.
func namespaceNetworkOwnRows(source networkIngestSource, gvr schema.GroupVersionResource, namespace string) []streamrows.NetworkSummary {
	if source == nil {
		return nil
	}
	rows := source.Rows(gvr)
	out := make([]streamrows.NetworkSummary, 0, len(rows))
	for _, raw := range rows {
		bundle, ok := raw.(ingest.Bundle)
		if !ok {
			continue
		}
		summary, ok := bundle.Table.(streamrows.NetworkSummary)
		if !ok {
			continue
		}
		if namespace != "" && summary.Namespace != namespace {
			continue
		}
		out = append(out, summary)
	}
	return out
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

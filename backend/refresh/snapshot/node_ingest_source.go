/*
 * backend/refresh/snapshot/node_ingest_source.go
 *
 * The node read path after the node cut. Node is an owned-reflector ingest kind: the shared
 * factory no longer caches the typed *corev1.Node. The nodes domain now serves each node's
 * projected OWN-fields NodeSummary (the Bundle Table half) from a per-cluster maintained store
 * fed by the node reflector's Sink (see RegisterNodeDomain), NOT through this source; what the
 * nodes domain still reads here is only the node store RV for its version watermark. The
 * cluster-overview domain reads each node's nodeOverviewFact (the Bundle Aggregate half) keyed
 * off NodeGVR via nodeOverviewFactsFromIngest. The nodes domain re-joins per-node pod aggregates
 * + metrics onto the own-rows at serve (reaggregateNodeSummary), reproducing the pre-cut node
 * row byte for byte; the overview sums the facts.
 *
 * Each kind's per-object Table half also carries the object's resourceVersion through the
 * ingest store's watermark, so a domain folds the store RV into its version watermark in place
 * of the per-object RV it can no longer read from the dropped typed objects.
 */

package snapshot

import (
	"strconv"

	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// nodeIngestSource supplies the cut node kind's projected rows the cluster-overview domain reads
// (the Aggregate-half facts via Rows) and the node store RV the nodes domain folds into its
// version watermark. Rows returns each node's per-object bundle in one consistent store read;
// StoreResourceVersion gives the store's latest list/watch RV for the version watermark;
// HasSyncedFor reports whether the node store has completed its initial relist (the overview's
// node-sync gate). *ingest.IngestManager satisfies it.
type nodeIngestSource interface {
	Rows(gvr schema.GroupVersionResource) []interface{}
	StoreResourceVersion(gvr schema.GroupVersionResource) string
	HasSyncedFor(gvr schema.GroupVersionResource) bool
}

// nodeOverviewFactsFromIngest reads the cut node kind's projected Aggregate-half overview facts
// from the ingest source, the cluster-overview per-node loop's input in place of the typed node.
// A nil source yields no facts; a row of the wrong type is skipped.
func nodeOverviewFactsFromIngest(source nodeIngestSource) []nodeOverviewFact {
	if source == nil {
		return nil
	}
	rows := source.Rows(NodeGVR)
	out := make([]nodeOverviewFact, 0, len(rows))
	for _, raw := range rows {
		bundle, ok := raw.(ingest.Bundle)
		if !ok {
			continue
		}
		fact, ok := bundle.Aggregate.(nodeOverviewFact)
		if !ok {
			continue
		}
		out = append(out, fact)
	}
	return out
}

// nodeDomainIngestVersion is the NODES SNAPSHOT's version watermark: the max of
// the node and pod store list/watch RVs (in place of the per-object RVs the cut
// kinds can no longer read). Node rows join per-node POD aggregates at serve
// (pod counts, requests/limits), so a pod add/delete changes served content and
// must advance the validator — folding only the node RV made those rebuilds
// answer 304 against the client's unchanged validator, silently keeping stale
// pod counts (mirrors the workloads domain's two-store watermark).
func nodeDomainIngestVersion(source nodeDomainIngestSource) uint64 {
	nodeVersion := ingestStoreVersion(source, NodeGVR)
	podVersion := ingestStoreVersion(source, PodGVR)
	if podVersion > nodeVersion {
		return podVersion
	}
	return nodeVersion
}

// ingestStoreVersion parses one store's latest list/watch resourceVersion as a
// uint64 watermark. A nil source or an unparseable RV yields 0.
func ingestStoreVersion(source nodeIngestSource, gvr schema.GroupVersionResource) uint64 {
	if source == nil {
		return 0
	}
	rv := source.StoreResourceVersion(gvr)
	if rv == "" {
		return 0
	}
	parsed, err := strconv.ParseUint(rv, 10, 64)
	if err != nil {
		return 0
	}
	return parsed
}

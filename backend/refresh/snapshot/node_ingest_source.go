/*
 * backend/refresh/snapshot/node_ingest_source.go
 *
 * The node read path after the node cut. Node is an owned-reflector ingest kind: the shared
 * factory no longer caches the typed *corev1.Node, so the nodes domain reads each node's
 * projected OWN-fields NodeSummary (the Bundle Table half) and the cluster-overview domain
 * reads each node's nodeOverviewFact (the Bundle Aggregate half), both keyed off NodeGVR,
 * instead of a typed lister. The nodes domain re-joins per-node pod aggregates + metrics onto
 * the own-rows at serve (reaggregateNodeSummary), reproducing the pre-cut node row byte for
 * byte; the overview sums the facts.
 *
 * Each kind's per-object Table half also carries the object's resourceVersion through the
 * ingest store's watermark, so a domain folds the store RV into its version watermark in place
 * of the per-object RV it can no longer read from the dropped typed objects.
 */

package snapshot

import (
	"strconv"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// nodeIngestSource supplies the cut node kind's projected rows the nodes and cluster-overview
// domains read. Rows returns each node's per-object bundle in one consistent store read;
// StoreResourceVersion gives the store's latest list/watch RV for the version watermark;
// HasSyncedFor reports whether the node store has completed its initial relist (the overview's
// node-sync gate). *ingest.IngestManager satisfies it.
type nodeIngestSource interface {
	Rows(gvr schema.GroupVersionResource) []interface{}
	StoreResourceVersion(gvr schema.GroupVersionResource) string
	HasSyncedFor(gvr schema.GroupVersionResource) bool
}

// nodeOwnRowsFromIngest reads the cut node kind's projected Table-half OWN-fields NodeSummary
// rows from the ingest source. A nil source yields no rows; a row of the wrong type is skipped,
// mirroring the type guards the ingest sinks apply. These are the own-rows the serve path
// re-joins pod aggregates + metrics onto.
func nodeOwnRowsFromIngest(source nodeIngestSource) []streamrows.NodeSummary {
	if source == nil {
		return nil
	}
	rows := source.Rows(NodeGVR)
	out := make([]streamrows.NodeSummary, 0, len(rows))
	for _, raw := range rows {
		bundle, ok := raw.(ingest.Bundle)
		if !ok {
			continue
		}
		summary, ok := bundle.Table.(streamrows.NodeSummary)
		if !ok {
			continue
		}
		out = append(out, summary)
	}
	return out
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

// nodeIngestVersion returns the node store's latest list/watch resourceVersion as the uint64
// watermark a snapshot domain folds into its version (in place of the per-node RV it can no
// longer read). A nil source or an unparseable RV yields 0.
func nodeIngestVersion(source nodeIngestSource) uint64 {
	if source == nil {
		return 0
	}
	rv := source.StoreResourceVersion(NodeGVR)
	if rv == "" {
		return 0
	}
	parsed, err := strconv.ParseUint(rv, 10, 64)
	if err != nil {
		return 0
	}
	return parsed
}

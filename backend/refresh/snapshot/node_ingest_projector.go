/*
 * backend/refresh/snapshot/node_ingest_projector.go
 *
 * The node kind's owned-reflector ingest projector. Nodes has NO streamspec.Descriptor (its
 * table is the bespoke NodeSummary, whose row joins per-node pod aggregates + metrics, not the
 * generic StreamRow dispatch), so the IngestManager's StreamDescriptors loop never builds it.
 * NewNodeIngestProjector is the bespoke ProjectFunc the system wires onto the manager via
 * RegisterReflector: it projects each reflector-decoded Node into a four-half ingest.Bundle so
 * one intake feeds every node consumer, and the typed Node — including its large
 * .status.images list, which no consumer reads — is then dropped:
 *
 *   - Table     = the OWN-fields NodeSummary (buildNodeOwnSummary; the per-node pod-aggregate
 *                 join + metrics overlay happen at serve in reaggregateNodeSummary, exactly as
 *                 the pre-cut single-pass loop did);
 *   - Aggregate = the nodeOverviewFact the cluster-overview domain sums (projectNodeOverviewFact);
 *   - Catalog   = the object-catalog Summary (objectcatalog.SummaryProjector);
 *   - ObjectMap = the object-map graph node (objectmapnode.NewNodeProjector from the node
 *                 collector status + action facts; nodes has no relationship edges).
 *
 * The Table half is built by the SAME buildNodeOwnSummary the serve path calls, so the
 * own-fields the reflector projects and the own-fields the serve path computes come from one
 * function, guaranteeing byte-equivalence (proven in node_ingest_projector_test.go). The
 * pod-aggregate join + metrics are NOT projected; they are re-joined at serve from the
 * already-cut pod store + LatestPodUsage/LatestNodeUsage, exactly as today.
 */

package snapshot

import (
	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	nodepkg "github.com/luxury-yacht/app/backend/resources/nodes"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// NodeGVR / NodeGVK are the node kind's group/version/resource and group/version/kind, the
// keys the system wires the bespoke node reflector under (RegisterReflector) and every
// cut-aware consumer reads the ingest store with.
var (
	NodeGVR = schema.GroupVersionResource{Group: nodepkg.Identity.Group, Version: nodepkg.Identity.Version, Resource: nodepkg.Identity.Resource}
	NodeGVK = schema.GroupVersionKind{Group: nodepkg.Identity.Group, Version: nodepkg.Identity.Version, Kind: nodepkg.Identity.Kind}
)

// nodeOverviewFact is the small reduced row the cluster-overview domain reads (the Bundle
// Aggregate half) instead of the typed *corev1.Node. It carries exactly the fields the
// overview's per-node loop sums/counts — allocatable CPU/memory, the NodeReady health bit,
// the cordoned bit, the Fargate/virtual-kubelet compute-type bits, and the version watermark
// contribution — so the overview never touches the dropped typed node.
type nodeOverviewFact struct {
	// AllocatableCPUMilli/AllocatableMemoryBytes are the node's allocatable CPU (millicores)
	// and memory (bytes), summed into the cluster's allocatable totals.
	AllocatableCPUMilli    int64
	AllocatableMemoryBytes int64
	// Ready is the NodeReady condition == True; the overview counts Ready vs NotReady nodes.
	Ready bool
	// Unschedulable is Spec.Unschedulable; the overview counts cordoned nodes.
	Unschedulable bool
	// IsFargate is the EKS Fargate compute-type label presence; IsVirtualKubelet is the AKS
	// Virtual-Node type=virtual-kubelet label. The overview buckets nodes by compute type.
	IsFargate        bool
	IsVirtualKubelet bool
	// Version is the per-node resourceVersion-or-creation watermark the overview folds into
	// its version, matching resourceVersionOrTimestamp on the typed node.
	Version uint64
}

// projectNodeOverviewFact reduces a typed Node to the nodeOverviewFact the cluster-overview
// per-node loop reads, reproducing exactly the reads at cluster_overview.go's node loop:
// allocatable CPU milli + memory bytes, the NodeReady==True health bit, Spec.Unschedulable,
// the EKS Fargate label, the AKS virtual-kubelet label, and resourceVersionOrTimestamp.
func projectNodeOverviewFact(node *corev1.Node) nodeOverviewFact {
	fact := nodeOverviewFact{
		AllocatableCPUMilli:    node.Status.Allocatable.Cpu().MilliValue(),
		AllocatableMemoryBytes: node.Status.Allocatable.Memory().Value(),
		Unschedulable:          node.Spec.Unschedulable,
		Version:                resourceVersionOrTimestamp(node),
	}
	for _, cond := range node.Status.Conditions {
		if cond.Type == corev1.NodeReady {
			fact.Ready = cond.Status == corev1.ConditionTrue
			break
		}
	}
	if _, ok := node.Labels["eks.amazonaws.com/compute-type"]; ok {
		fact.IsFargate = true
	}
	if node.Labels["type"] == "virtual-kubelet" {
		fact.IsVirtualKubelet = true
	}
	return fact
}

// NewNodeIngestProjector returns the ingest.ProjectFunc that projects a reflector-decoded
// Node into the four-half Bundle every node consumer reads. meta stamps the NodeSummary's
// cluster identity and the catalog Summary / object-map node cluster id. The Table half
// carries the node's OWN fields only (no pods, no metrics) — the serve-time re-join is
// unchanged — exactly as the maintained-store handler projected before the cutover.
func NewNodeIngestProjector(meta ClusterMeta) ingest.ProjectFunc {
	catalogProject := objectcatalog.SummaryProjector(meta.ClusterID, meta.ClusterName, nodepkg.Identity)
	// Nodes contributes a graph node (status + cordoned action facts) but no relationship
	// edges (its descriptor sets no ObjectMapEdges), so the object-map projector is built
	// with a nil edge builder — the resolver derives node↔pod traversal at resolve time.
	nodeProject := objectmapnode.NewNodeProjector(
		nodepkg.ObjectMapNode.Status,
		nodepkg.ObjectMapNode.ActionFacts,
		nil,
	)
	return func(obj interface{}) (interface{}, error) {
		node, ok := obj.(*corev1.Node)
		if !ok {
			return nil, errNotNodeObject
		}
		var metaObj metav1.Object = node
		return ingest.Bundle{
			Table:     buildNodeOwnSummary(meta, node),
			Aggregate: projectNodeOverviewFact(node),
			Catalog:   catalogProject(metaObj),
			ObjectMap: nodeProject(meta.ClusterID, metaObj),
		}, nil
	}
}

// errNotNodeObject is returned when the reflector decodes a non-Node into the node store;
// the ProjectingStore logs it once and skips the object, matching the per-kind type guard
// every projection applies.
var errNotNodeObject = nodeProjectionError("ingest: node projector received a non-Node object")

type nodeProjectionError string

func (e nodeProjectionError) Error() string { return string(e) }

package snapshot

import (
	"reflect"
	"testing"

	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	nodepkg "github.com/luxury-yacht/app/backend/resources/nodes"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func testNode() *corev1.Node {
	return &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "node-1",
			UID:               "node-uid-1",
			CreationTimestamp: metav1.Now(),
			ResourceVersion:   "4242",
			Labels: map[string]string{
				"node-role.kubernetes.io/worker": "",
				"type":                           "virtual-kubelet",
			},
			Annotations: map[string]string{"a": "b"},
		},
		Spec: corev1.NodeSpec{
			Unschedulable: true,
			Taints:        []corev1.Taint{{Key: "k", Value: "v", Effect: corev1.TaintEffectNoSchedule}},
		},
		Status: corev1.NodeStatus{
			Capacity: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("4"),
				corev1.ResourceMemory: resource.MustParse("16Gi"),
				corev1.ResourcePods:   resource.MustParse("110"),
			},
			Allocatable: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("3800m"),
				corev1.ResourceMemory: resource.MustParse("15Gi"),
				corev1.ResourcePods:   resource.MustParse("110"),
			},
			NodeInfo:  corev1.NodeSystemInfo{KubeletVersion: "v1.30.0"},
			Addresses: []corev1.NodeAddress{{Type: corev1.NodeInternalIP, Address: "10.0.0.1"}, {Type: corev1.NodeExternalIP, Address: "1.2.3.4"}},
			Conditions: []corev1.NodeCondition{
				{Type: corev1.NodeReady, Status: corev1.ConditionTrue},
			},
			// Large list the node table does not need; the projection must drop it.
			Images: []corev1.ContainerImage{{Names: []string{"img:tag"}, SizeBytes: 999}},
		},
	}
}

// TestNewNodeIngestProjectorBundleMatchesLivePaths proves the bundle the node ingest
// projector builds is byte-equivalent, half by half, to what each live consumer path
// builds from the typed node:
//
//   - Table     == the OWN-fields NodeSummary (no pods, no usage) the serve path re-joins;
//   - Aggregate == the node-overview fact cluster-overview sums;
//   - Catalog   == objectcatalog.SummaryProjector for nodes;
//   - ObjectMap == objectmapnode.NewNodeProjector from the node descriptor (no edges).
func TestNewNodeIngestProjectorBundleMatchesLivePaths(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c-1", ClusterName: "prod"}
	node := testNode()

	project := NewNodeIngestProjector(meta)
	raw, err := project(node)
	if err != nil {
		t.Fatalf("projector returned error: %v", err)
	}
	bundle, ok := raw.(ingest.Bundle)
	if !ok {
		t.Fatalf("projector returned %T, want ingest.Bundle", raw)
	}

	wantTable := buildNodeOwnSummary(meta, node)
	gotTable, ok := bundle.Table.(streamrows.NodeSummary)
	if !ok {
		t.Fatalf("Table half is %T, want streamrows.NodeSummary", bundle.Table)
	}
	if !reflect.DeepEqual(gotTable, wantTable) {
		t.Fatalf("Table half mismatch:\n got=%#v\nwant=%#v", gotTable, wantTable)
	}

	wantAgg := projectNodeOverviewFact(node)
	gotAgg, ok := bundle.Aggregate.(nodeOverviewFact)
	if !ok {
		t.Fatalf("Aggregate half is %T, want nodeOverviewFact", bundle.Aggregate)
	}
	if gotAgg != wantAgg {
		t.Fatalf("Aggregate half mismatch:\n got=%#v\nwant=%#v", gotAgg, wantAgg)
	}

	catalogProject := objectcatalog.SummaryProjector(meta.ClusterID, meta.ClusterName, nodepkg.Identity)
	wantCatalog, ok := catalogProject(node).(objectcatalog.Summary)
	if !ok {
		t.Fatalf("catalogProject returned %T, want objectcatalog.Summary", catalogProject(node))
	}
	gotCatalog, ok := bundle.Catalog.(objectcatalog.Summary)
	if !ok {
		t.Fatalf("Catalog half is %T, want objectcatalog.Summary", bundle.Catalog)
	}
	if !reflect.DeepEqual(gotCatalog, wantCatalog) {
		t.Fatalf("Catalog half mismatch:\n got=%#v\nwant=%#v", gotCatalog, wantCatalog)
	}

	nodeProject := objectmapnode.NewNodeProjector(nodepkg.ObjectMapNode.Status, nodepkg.ObjectMapNode.ActionFacts, nil)
	wantNode := nodeProject(meta.ClusterID, node)
	gotNode, ok := bundle.ObjectMap.(objectmapnode.Node)
	if !ok {
		t.Fatalf("ObjectMap half is %T, want objectmapnode.Node", bundle.ObjectMap)
	}
	if !reflect.DeepEqual(gotNode, wantNode) {
		t.Fatalf("ObjectMap half mismatch:\n got=%#v\nwant=%#v", gotNode, wantNode)
	}
}

// TestNewNodeIngestProjectorRejectsNonNode proves a non-Node object yields the typed
// guard error so the ProjectingStore logs-once and skips it, never panicking.
func TestNewNodeIngestProjectorRejectsNonNode(t *testing.T) {
	project := NewNodeIngestProjector(ClusterMeta{ClusterID: "c-1"})
	if _, err := project(&corev1.ConfigMap{}); err == nil {
		t.Fatal("expected error for non-Node object, got nil")
	}
}

package customresource

import (
	"encoding/json"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/resourcemodel"

	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"testing"
)

func TestKarpenterDetailsAndTableProjectionParity(t *testing.T) {
	object := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "karpenter.sh/v1", "kind": "NodePool",
		"metadata": map[string]any{"name": "default", "labels": map[string]any{"team": "infra"}},
		"spec":     map[string]any{"weight": int64(10)},
		"status":   map[string]any{"conditions": []any{map[string]any{"type": "Ready", "status": "False", "reason": "NodeClassNotReady", "message": "NodeClass is not ready"}}},
	}}
	require.NoError(t, unstructured.SetNestedMap(object.Object, map[string]any{"cpu": "1250m", "memory": "768Gi"}, "status", "resources"))
	require.NoError(t, unstructured.SetNestedMap(object.Object, map[string]any{"cpu": "2", "memory": "1Ti"}, "spec", "limits"))
	descriptor := NewDescriptor("karpenter.sh", "v1", "nodepools", "NodePool", "nodepools.karpenter.sh")
	row := BuildClusterStreamSummary(streamrows.ClusterMeta{ClusterID: "cluster-a"}, object, descriptor)
	detail := BuildDetails("cluster-a", object, descriptor, resourcemodel.ResourceScopeCluster)
	require.Equal(t, "karpenter", detail.ResourceFamily)
	require.Equal(t, row.Status, detail.Status)
	require.Equal(t, row.StatusPresentation, detail.StatusPresentation)
	require.Equal(t, row.Ref, detail.Ref)
	require.Equal(t, row.Conditions, detail.Conditions)
	require.Equal(t, "infra", detail.Labels["team"])
	require.Equal(t, karpenterTableSummary(detail.Karpenter), row.Karpenter)
	encoded, err := json.Marshal(row.Karpenter)
	require.NoError(t, err)
	var wire map[string]map[string]string
	require.NoError(t, json.Unmarshal(encoded, &wire))
	require.Equal(t, detail.Karpenter.Capacity, wire["capacity"], "table usage must preserve source units and match details")
	require.Equal(t, detail.Karpenter.Limits, wire["limits"])
	require.Equal(t, "warning", row.StatusPresentation)
	require.NoError(t, resourcemodel.ValidateResourceRef(detail.Ref))
}

func TestKarpenterTableExposesNamedFieldsWithoutConfigurationBlobs(t *testing.T) {
	object := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "karpenter.sh/v1beta1", "kind": "NodeClaim",
		"metadata": map[string]any{"name": "claim", "labels": map[string]any{"karpenter.sh/nodepool": "pool", "node.kubernetes.io/instance-type": "m7g.large", "karpenter.sh/capacity-type": "spot"}},
		"spec":     map[string]any{"nodeClassRef": map[string]any{"apiVersion": "karpenter.k8s.aws/v1beta1", "kind": "EC2NodeClass", "name": "class"}},
	}}
	descriptor := NewDescriptor("karpenter.sh", "v1beta1", "nodeclaims", "NodeClaim", "nodeclaims.karpenter.sh")
	row := BuildClusterStreamSummary(streamrows.ClusterMeta{ClusterID: "cluster-a"}, object, descriptor)
	encoded, err := json.Marshal(row)
	require.NoError(t, err)
	var wire map[string]any
	require.NoError(t, json.Unmarshal(encoded, &wire))
	require.NotContains(t, wire, "details")
	summary, ok := wire["karpenter"].(map[string]any)
	require.True(t, ok, "table summary must expose named Karpenter fields")
	require.Equal(t, "m7g.large", summary["instanceType"])
	require.Equal(t, "spot", summary["capacityType"])
	require.Len(t, summary, 4)
}

func TestGenericClusterCustomRowsOmitKarpenterSummary(t *testing.T) {
	descriptor := NewDescriptor("example.com", "v1", "widgets", "Widget", "widgets.example.com")
	meta := streamrows.ClusterMeta{ClusterID: "cluster-a"}
	object := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "example.com/v1", "kind": "Widget", "metadata": map[string]any{"name": "sample"},
	}}
	row := BuildClusterStreamSummary(meta, object, descriptor)
	require.Nil(t, row.Karpenter)
	require.Equal(t, "sample", row.Ref.Name)
	require.Equal(t, "cluster-a", row.Ref.ClusterID)
	empty := BuildClusterStreamSummary(meta, nil, descriptor)
	require.Nil(t, empty.Karpenter)
	require.Equal(t, "Widget", empty.Ref.Kind)
	require.Equal(t, "cluster-a", empty.Ref.ClusterID)
}

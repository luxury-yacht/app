package customresource

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/karpenter"
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
	descriptor := NewDescriptor("karpenter.sh", "v1", "nodepools", "NodePool", "nodepools.karpenter.sh")
	row := BuildClusterStreamSummary(streamrows.ClusterMeta{ClusterID: "cluster-a"}, object, descriptor)
	detail := BuildDetails("cluster-a", object, descriptor)
	require.Equal(t, "karpenter", detail.ResourceFamily)
	require.Equal(t, row.Status, detail.Status)
	require.Equal(t, row.StatusPresentation, detail.StatusPresentation)
	require.Equal(t, row.Ref, detail.Ref)
	require.Equal(t, row.Conditions, detail.Conditions)
	require.Equal(t, "infra", detail.Labels["team"])
	require.Equal(t, karpenter.TableDetails(detail.Karpenter), row.Details)
	require.Equal(t, "warning", row.StatusPresentation)
	require.NoError(t, resourcemodel.ValidateResourceRef(detail.Ref))
}

package karpenter

import (
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"testing"
)

func TestKarpenterFactsPreserveSourceValuesAndReferenceVersions(t *testing.T) {
	pool := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "karpenter.sh/v1", "kind": "NodePool",
		"metadata": map[string]any{"name": "default"},
		"spec": map[string]any{
			"weight": int64(0), "replicas": int64(0), "limits": map[string]any{"cpu": "1000", "memory": "2Ti"},
			"disruption": map[string]any{"consolidationPolicy": "WhenEmptyOrUnderutilized", "consolidateAfter": "30s"},
			"template": map[string]any{"spec": map[string]any{
				"nodeClassRef": map[string]any{"group": "karpenter.k8s.aws", "kind": "EC2NodeClass", "name": "default"},
				"expireAfter":  "720h", "requirements": []any{map[string]any{"key": "kubernetes.io/arch", "operator": "In", "values": []any{"arm64"}}},
			}},
		},
		"status": map[string]any{"resources": map[string]any{"cpu": "8", "nodes": int64(2)}},
	}}
	facts := BuildFacts("cluster-a", pool)
	require.NotNil(t, facts)
	require.Equal(t, int64(0), *facts.Weight)
	require.Equal(t, int64(0), *facts.Replicas)
	require.Equal(t, "1000", facts.Limits["cpu"])
	require.Equal(t, "2", facts.Capacity["nodes"])
	require.Equal(t, "720h", facts.ExpireAfter)
	require.Equal(t, "WhenEmptyOrUnderutilized", facts.ConsolidationPolicy)
	require.Equal(t, []Requirement{{Key: "kubernetes.io/arch", Operator: "In", Values: []string{"arm64"}}}, facts.Requirements)
	require.Nil(t, facts.NodeClass.Ref, "v1 nodeClassRef has no version; do not guess it")
	require.Equal(t, "default", facts.NodeClass.Display.Name)
	pool.SetAPIVersion("unrelated.io/v1")
	require.Nil(t, BuildFacts("cluster-a", pool))
}

func TestKarpenterNodeClaimAndProviderFacts(t *testing.T) {
	claim := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "karpenter.sh/v1beta1", "kind": "NodeClaim",
		"metadata": map[string]any{"name": "claim", "labels": map[string]any{"karpenter.sh/nodepool": "pool", "node.kubernetes.io/instance-type": "m7g.large", "karpenter.sh/capacity-type": "spot"}, "ownerReferences": []any{map[string]any{"apiVersion": "karpenter.sh/v1beta1", "kind": "NodePool", "name": "pool"}}},
		"spec":     map[string]any{"nodeClassRef": map[string]any{"apiVersion": "karpenter.k8s.aws/v1beta1", "kind": "EC2NodeClass", "name": "class"}},
		"status":   map[string]any{"nodeName": "node", "providerID": "aws:///zone/i-123", "capacity": map[string]any{"cpu": "2", "memory": "8Gi"}, "allocatable": map[string]any{"cpu": "1930m"}},
	}}
	facts := BuildFacts("cluster-b", claim)
	require.Equal(t, "cluster-b", facts.Node.Ref.ClusterID)
	require.Equal(t, "v1", facts.Node.Ref.Version)
	require.Equal(t, "v1beta1", facts.NodePool.Ref.Version)
	require.Equal(t, "v1beta1", facts.NodeClass.Ref.Version)
	require.Equal(t, "spot", facts.CapacityType)
	require.Equal(t, "m7g.large", facts.InstanceType)
	require.Equal(t, "1930m", facts.Allocatable["cpu"])
	provider := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "karpenter.azure.com/v1beta1", "kind": "AKSNodeClass", "metadata": map[string]any{"name": "class"},
		"spec": map[string]any{"imageFamily": "Ubuntu", "osDiskSizeGB": int64(128)},
	}}
	require.Equal(t, "Ubuntu", BuildFacts("cluster-b", provider).ImageFamily)
	provider.SetNamespace("unexpected")
	require.Nil(t, BuildFacts("cluster-b", provider))
	require.Nil(t, BuildFacts("cluster-b", nil))
}

func TestKarpenterProviderResolutionAndLabelOnlyRelationships(t *testing.T) {
	provider := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "karpenter.k8s.aws/v1", "kind": "EC2NodeClass", "metadata": map[string]any{"name": "class"},
		"spec":   map[string]any{"role": "node-role", "amiFamily": "AL2023", "tags": map[string]any{"team": "platform"}},
		"status": map[string]any{"instanceProfile": "generated-profile", "subnets": []any{map[string]any{"id": "subnet-1", "zone": "zone-a"}}, "securityGroups": []any{map[string]any{"id": "sg-1"}}, "amis": []any{map[string]any{"id": "ami-1"}}},
	}}
	facts := BuildFacts("a", provider)
	require.Equal(t, "node-role", facts.Role)
	require.Equal(t, "generated-profile", facts.InstanceProfile)
	require.Equal(t, []string{"subnet-1"}, facts.Subnets)
	require.Equal(t, []string{"sg-1"}, facts.SecurityGroups)
	require.Equal(t, []string{"ami-1"}, facts.Images)
	require.Equal(t, map[string]string{"team": "platform"}, facts.Tags)
	claim := &unstructured.Unstructured{Object: map[string]any{"apiVersion": "karpenter.sh/v1", "kind": "NodeClaim", "metadata": map[string]any{"name": "claim", "labels": map[string]any{"karpenter.sh/nodepool": "pool"}}}}
	facts = BuildFacts("a", claim)
	require.Nil(t, facts.NodePool.Ref)
	require.Equal(t, "pool", facts.NodePool.Display.Name)
	require.Nil(t, facts.NodeClass)
	require.Nil(t, facts.Node)
	require.Nil(t, facts.Weight)
	overlay := &unstructured.Unstructured{Object: map[string]any{"apiVersion": "karpenter.sh/v1alpha1", "kind": "NodeOverlay", "metadata": map[string]any{"name": "reserved"}, "spec": map[string]any{"priceAdjustment": "-10%", "capacity": map[string]any{"cpu": "8"}}}}
	facts = BuildFacts("a", overlay)
	require.Equal(t, "-10%", facts.PriceAdjustment)
	require.Equal(t, "8", facts.Capacity["cpu"])
	require.Nil(t, facts.Weight)
}

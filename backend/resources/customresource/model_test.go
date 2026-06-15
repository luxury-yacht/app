package customresource

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func TestBuildResourceModelExtractsDynamicStatus(t *testing.T) {
	resource := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "databases.example.com/v1alpha1",
		"kind":       "Database",
		"metadata": map[string]any{
			"name":       "orders",
			"namespace":  "apps",
			"uid":        "database-uid",
			"generation": int64(4),
		},
		"status": map[string]any{
			"phase":              "Reconciling",
			"ready":              false,
			"observedGeneration": int64(3),
			"conditions": []any{map[string]any{
				"type":               "Ready",
				"status":             "False",
				"reason":             "WaitingForStorage",
				"message":            "volume is not ready",
				"lastTransitionTime": "2026-01-04T12:00:00Z",
			}},
		},
	}}
	gvr := schema.GroupVersionResource{Group: "databases.example.com", Version: "v1alpha1", Resource: "databases"}

	model := BuildResourceModel("cluster-a", resource, gvr, "Database", "databases.databases.example.com", resourcemodel.ResourceScopeNamespaced, "")
	require.Equal(t, resourcemodel.ResourceRef{
		ClusterID: "cluster-a",
		Group:     "databases.example.com",
		Version:   "v1alpha1",
		Kind:      "Database",
		Resource:  "databases",
		Namespace: "apps",
		Name:      "orders",
		UID:       "database-uid",
	}, model.Ref)
	require.Equal(t, "Reconciling", model.Status.State)
	require.Equal(t, "progressing", model.Status.Presentation)

	facts := BuildFacts("cluster-a", resource, gvr, "databases.databases.example.com", resourcemodel.ResourceModelBuildOptions{})
	require.Equal(t, "Reconciling", facts.Phase)
	require.False(t, *facts.Ready)
	require.Equal(t, int64(3), *facts.ObservedGeneration)
	require.Len(t, facts.Conditions, 1)
	require.Equal(t, "Ready", facts.Conditions[0].Type)
	require.Equal(t, "False", facts.Conditions[0].Status)
	require.Equal(t, "CustomResourceDefinition", facts.CRD.Ref.Kind)
	require.Equal(t, "databases.databases.example.com", facts.CRD.Ref.Name)
}

func TestBuildFactsMaterializationControlsRawStatus(t *testing.T) {
	resource := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "databases.example.com/v1alpha1",
		"kind":       "Database",
		"metadata": map[string]any{
			"name":      "orders",
			"namespace": "apps",
		},
		"status": map[string]any{
			"phase":   "Reconciling",
			"message": "large provider-specific payload",
		},
	}}
	gvr := schema.GroupVersionResource{Group: "databases.example.com", Version: "v1alpha1", Resource: "databases"}

	summary := BuildFacts("cluster-a", resource, gvr, "", resourcemodel.ResourceModelBuildOptions{})
	require.Equal(t, "Reconciling", summary.Phase)
	require.Empty(t, summary.RawStatus)

	detail := BuildFacts("cluster-a", resource, gvr, "", resourcemodel.ResourceModelBuildOptions{
		Materialization: resourcemodel.MaterializeSummaryFacts | resourcemodel.MaterializeDetailFacts,
	})
	require.Equal(t, "large provider-specific payload", detail.RawStatus["message"])
}

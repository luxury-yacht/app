package customresource

import (
	"testing"

	"github.com/luxury-yacht/app/backend/kind/streamrows"

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

	model := BuildResourceModel("cluster-a", resource, Descriptor{
		GVR: gvr, KindFallback: "Database", CRDName: "databases.databases.example.com",
	}, resourcemodel.ResourceScopeNamespaced, "")
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

	facts := BuildFacts(resource)
	require.Equal(t, "Reconciling", facts.Phase)
	require.False(t, *facts.Ready)
	require.Equal(t, int64(3), *facts.ObservedGeneration)
	require.Len(t, facts.Conditions, 1)
	require.Equal(t, "Ready", facts.Conditions[0].Type)
	require.Equal(t, "False", facts.Conditions[0].Status)
}

func TestBuildResourceModelLeavesConfigOnlyMonitorsWithoutStatusUntilDeleted(t *testing.T) {
	resource := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "monitoring.coreos.com/v1",
		"kind":       "ServiceMonitor",
		"metadata":   map[string]any{"name": "web", "namespace": "team-a", "uid": "sm-uid"},
		"spec":       map[string]any{"endpoints": []any{map[string]any{"port": "metrics"}}},
	}}
	descriptor := Descriptor{
		GVR:          schema.GroupVersionResource{Group: "monitoring.coreos.com", Version: "v1", Resource: "servicemonitors"},
		KindFallback: "ServiceMonitor",
		CRDName:      "servicemonitors.monitoring.coreos.com",
	}

	model := BuildResourceModel("cluster-a", resource, descriptor, resourcemodel.ResourceScopeNamespaced, "")
	require.Empty(t, model.Status.Label)
	require.Empty(t, model.Status.Presentation)

	resource.Object["metadata"].(map[string]any)["deletionTimestamp"] = "2026-09-14T10:00:00Z"
	model = BuildResourceModel("cluster-a", resource, descriptor, resourcemodel.ResourceScopeNamespaced, "")
	require.Equal(t, "Terminating", model.Status.Label)
	require.Equal(t, "terminating", model.Status.Presentation)
}

func TestDynamicReadinessAndConditionsReachDetailAndTable(t *testing.T) {
	for _, test := range []struct {
		name      string
		ready     any
		phase     string
		state     string
		condition any
		wantLabel string
		wantReady any
	}{
		{"boolean overrides condition", false, "", "", "True", "Not Ready", false},
		{"string overrides condition", "TRUE", "", "", "False", "Ready", true},
		{"condition supplies missing readiness", nil, "", "", true, "Ready", true},
		{"unknown explicit readiness is not coerced", "unknown", "", "", "True", "True", nil},
		{"unknown condition stays unknown", nil, "", "", "Unknown", "Unknown", nil},
		{"phase takes precedence", true, "Reconciling", "Failed", "True", "Reconciling", true},
		{"state takes precedence over readiness", true, "", "Failed", "True", "Failed", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			status := map[string]any{"phase": test.phase, "state": test.state, "conditions": []any{
				"invalid", map[string]any{},
				map[string]any{"type": "rEaDy", "status": test.condition, "reason": "ControllerState", "lastTransitionTime": "2026-09-01T12:00:00Z"},
				map[string]any{"status": "Unknown", "lastTransitionTime": "invalid"},
			}}
			if test.ready != nil {
				status["ready"] = test.ready
			}
			object := &unstructured.Unstructured{Object: map[string]any{
				"apiVersion": "example.com/v1", "kind": "Widget",
				"metadata": map[string]any{"name": "widget", "namespace": "apps", "labels": map[string]any{"team": "infra"}},
				"status":   status,
			}}
			descriptor := NewDescriptor("example.com", "v1", "widgets", "Widget", "widgets.example.com")
			detail := BuildDetails("cluster-a", object, descriptor, resourcemodel.ResourceScopeNamespaced)
			row := BuildNamespaceStreamSummary(streamrows.ClusterMeta{ClusterID: "cluster-a"}, object, descriptor, "fallback")
			require.Equal(t, detail.Ref, row.Ref)
			require.Equal(t, "apps", row.Ref.Namespace)
			require.Equal(t, test.wantLabel, detail.Status)
			require.Equal(t, detail.Status, row.Status)
			require.Equal(t, detail.Conditions, row.Conditions)
			require.Len(t, detail.Conditions, 2)
			require.Equal(t, "ControllerState", detail.Conditions[0].Reason)
			require.False(t, detail.Conditions[0].LastTransitionTime.IsZero())
			require.True(t, detail.Conditions[1].LastTransitionTime.IsZero())
			if test.wantReady == nil {
				require.Nil(t, row.Ready)
			} else {
				require.NotNil(t, row.Ready)
				require.Equal(t, test.wantReady, *row.Ready)
			}
			detail.Labels["team"] = "changed"
			require.Equal(t, "infra", row.Labels["team"])
			require.Equal(t, "infra", object.GetLabels()["team"])
		})
	}
}

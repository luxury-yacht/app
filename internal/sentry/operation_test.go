package sentryreporting

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestKubernetesRequestOperationEmitsOnlyAllowlistedStructuralFields(t *testing.T) {
	operation := NewKubernetesRequestOperation(KubernetesRequest{
		Action:      KubernetesActionGet,
		Group:       "storage.example.com",
		Version:     "v1alpha1",
		Resource:    "databasebackups",
		Subresource: "status",
		Scope:       KubernetesScopeNamespaced,
	})

	require.Equal(t, map[string]any{
		"type":        "kubernetes.request",
		"action":      "get",
		"group":       "storage.example.com",
		"version":     "v1alpha1",
		"resource":    "databasebackups",
		"subresource": "status",
		"scope":       "namespaced",
	}, operation.telemetryContext())
}

func TestKubernetesRequestOperationDropsValuesOutsideTheAllowlist(t *testing.T) {
	operation := NewKubernetesRequestOperation(KubernetesRequest{
		Action:      KubernetesAction("get customer-prod/backup-7"),
		Group:       "storage.example.com/customer-prod",
		Version:     "v1 customer-prod",
		Resource:    "databasebackups/customer-prod/backup-7",
		Subresource: "status/customer-prod",
		Scope:       KubernetesScope("namespace customer-prod"),
	})

	require.Equal(t, map[string]any{
		"type": "kubernetes.request",
	}, operation.telemetryContext())
}

func TestKubernetesCapabilityBatchOperationKeepsOnlyFailedRequestShapes(t *testing.T) {
	operation := NewKubernetesCapabilityBatchOperation(2, 7, []KubernetesRequest{
		{
			Action:   KubernetesActionList,
			Group:    "gateway.networking.k8s.io",
			Version:  "v1",
			Resource: "httproutes",
			Scope:    KubernetesScopeNamespaced,
		},
		{
			Action:      KubernetesActionUpdate,
			Group:       "apps",
			Version:     "v1",
			Resource:    "statefulsets",
			Subresource: "scale",
			Scope:       KubernetesScopeNamespaced,
		},
	})

	require.Equal(t, map[string]any{
		"type":          "kubernetes.capability_batch",
		"failure_count": 2,
		"total_count":   7,
		"failed_checks": []map[string]any{
			{
				"action":   "list",
				"group":    "gateway.networking.k8s.io",
				"version":  "v1",
				"resource": "httproutes",
				"scope":    "namespaced",
			},
			{
				"action":      "update",
				"group":       "apps",
				"version":     "v1",
				"resource":    "statefulsets",
				"subresource": "scale",
				"scope":       "namespaced",
			},
		},
	}, operation.telemetryContext())
}

func TestOperationPrivacyBoundaryRejectsUnknownTypesAndFields(t *testing.T) {
	require.Nil(t, sanitizeOperationTelemetryContext("get customer-prod/database"))
	require.Nil(t, sanitizeOperationTelemetryContext(map[string]any{
		"type":      "future.unreviewed",
		"namespace": "customer-prod",
		"name":      "database",
	}))

	sanitized := sanitizeOperationTelemetryContext(map[string]any{
		"type":      "kubernetes.request",
		"action":    "get",
		"version":   "v1",
		"resource":  "pods",
		"scope":     "namespaced",
		"namespace": "customer-prod",
		"name":      "database",
	})
	require.Equal(t, map[string]any{
		"type":     "kubernetes.request",
		"action":   "get",
		"version":  "v1",
		"resource": "pods",
		"scope":    "namespaced",
	}, sanitized)
}

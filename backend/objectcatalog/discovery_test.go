/*
 * backend/objectcatalog/discovery_test.go
 *
 * API discovery descriptor tests.
 */

package objectcatalog

import (
	"testing"

	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestExtractDescriptorsFiltersUnsupportedDiscoveryResources(t *testing.T) {
	descriptors := ExtractDescriptors([]*metav1.APIResourceList{
		{
			GroupVersion: "apps/v1",
			APIResources: []metav1.APIResource{
				{Name: "widgets", Namespaced: true, Kind: "Widget", Verbs: []string{"get"}},
				{Name: "gizmos", Namespaced: true, Kind: "Gizmo", Verbs: []string{"get", "list"}},
				{Name: "deployments/status", Namespaced: true, Kind: "Deployment", Verbs: []string{"get", "list"}},
			},
		},
		{
			GroupVersion: "v1",
			APIResources: []metav1.APIResource{
				{Name: "configmaps", Namespaced: true, Kind: "ConfigMap", Verbs: []string{"list"}},
				{Name: "events", Namespaced: true, Kind: "Event", Verbs: []string{"list"}},
				{Name: "componentstatuses", Kind: "ComponentStatus", Verbs: []string{"list"}},
			},
		},
		{
			GroupVersion: "metrics.k8s.io/v1beta1",
			APIResources: []metav1.APIResource{
				{Name: "pods", Namespaced: true, Kind: "PodMetrics", Verbs: []string{"list"}},
				{Name: "nodes", Kind: "NodeMetrics", Verbs: []string{"list"}},
			},
		},
	})

	require.Equal(t, []Descriptor{
		{Group: "apps", Version: "v1", Resource: "gizmos", Kind: "Gizmo", Scope: ScopeNamespace, Namespaced: true},
		{Group: "", Version: "v1", Resource: "configmaps", Kind: "ConfigMap", Scope: ScopeNamespace, Namespaced: true},
	}, descriptors)
}

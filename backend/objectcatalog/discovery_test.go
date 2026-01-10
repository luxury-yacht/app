/*
 * backend/objectcatalog/discovery_test.go
 *
 * API discovery descriptor tests.
 */

package objectcatalog

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestExtractDescriptorsSkipsUnsupported(t *testing.T) {
	resourceLists := []*metav1.APIResourceList{
		{
			GroupVersion: "apps/v1",
			APIResources: []metav1.APIResource{
				{
					Name:       "widgets",
					Namespaced: true,
					Kind:       "Widget",
					Verbs:      []string{"get"},
				},
				{
					Name:       "gizmos",
					Namespaced: true,
					Kind:       "Gizmo",
					Verbs:      []string{"get", "list"},
				},
				{
					Name:       "deployments",
					Namespaced: true,
					Kind:       "Deployment",
					Verbs:      []string{"get", "list"},
				},
				{
					Name:       "deployments/status",
					Namespaced: true,
					Kind:       "Deployment",
					Verbs:      []string{"get"},
				},
			},
		},
		{
			GroupVersion: "v1",
			APIResources: []metav1.APIResource{
				{
					Name:       "events",
					Namespaced: true,
					Kind:       "Event",
					Verbs:      []string{"get", "list"},
				},
				{
					Name:       "componentstatuses",
					Namespaced: false,
					Kind:       "ComponentStatus",
					Verbs:      []string{"get", "list"},
				},
			},
		},
	}

	svc := NewService(Dependencies{Common: common.Dependencies{}}, nil)
	descriptors := svc.extractDescriptors(resourceLists)
	if len(descriptors) != 2 {
		t.Fatalf("expected 2 descriptors, got %d", len(descriptors))
	}
	resources := map[string]struct{}{}
	for _, desc := range descriptors {
		resources[desc.Resource] = struct{}{}
	}
	if _, ok := resources["deployments"]; !ok {
		t.Fatalf("expected deployments descriptor, got %+v", descriptors)
	}
	if _, ok := resources["gizmos"]; !ok {
		t.Fatalf("expected gizmos descriptor, got %+v", descriptors)
	}
}

/*
 * backend/objectcatalog/state_test.go
 *
 * Catalog state snapshot tests.
 */

package objectcatalog

import (
	"reflect"
	"testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func TestServiceNamespacesUsesCachedOrDerivedValues(t *testing.T) {
	svc := NewService(Dependencies{}, nil)
	svc.items = map[string]Summary{
		"one":   {Namespace: "default"},
		"two":   {Namespace: "kube-system"},
		"three": {Namespace: "default"},
		"four":  {Namespace: ""},
	}

	namespaces := svc.Namespaces()
	if !reflect.DeepEqual(namespaces, []string{"default", "kube-system"}) {
		t.Fatalf("unexpected namespaces: %#v", namespaces)
	}

	svc.cachedNamespaces = []string{"cached"}
	namespaces = svc.Namespaces()
	if !reflect.DeepEqual(namespaces, []string{"cached"}) {
		t.Fatalf("expected cached namespaces, got %#v", namespaces)
	}
}

func TestDescriptorsSortedCopy(t *testing.T) {
	descA := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "a.example.com", Version: "v1", Resource: "widgets"},
		Namespaced: true,
		Kind:       "Widget",
		Group:      "a.example.com",
		Version:    "v1",
		Resource:   "widgets",
		Scope:      ScopeNamespace,
	}
	descB := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"},
		Namespaced: true,
		Kind:       "Pod",
		Group:      "",
		Version:    "v1",
		Resource:   "pods",
		Scope:      ScopeNamespace,
	}

	svc := NewService(Dependencies{Common: common.Dependencies{}}, nil)
	svc.mu.Lock()
	svc.resources = map[string]resourceDescriptor{
		descB.GVR.String(): descB,
		descA.GVR.String(): descA,
	}
	svc.mu.Unlock()

	descriptors := svc.Descriptors()
	if len(descriptors) != 2 {
		t.Fatalf("expected 2 descriptors, got %d", len(descriptors))
	}
	if descriptors[0].Group != "" || descriptors[0].Kind != "Pod" {
		t.Fatalf("expected descriptors sorted by group/version/resource, got %+v", descriptors)
	}

	descriptors[0].Kind = "Mutated"
	svc.mu.RLock()
	orig := svc.resources[descB.GVR.String()]
	svc.mu.RUnlock()
	if orig.Kind != "Pod" {
		t.Fatalf("expected original descriptor to remain unchanged")
	}
}

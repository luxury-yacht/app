package backend

import "testing"

func TestLookupBuiltinResourceByGVK(t *testing.T) {
	tests := []struct {
		name       string
		group      string
		version    string
		kind       string
		resource   string
		namespaced bool
	}{
		{name: "core namespaced", group: "", version: "v1", kind: "Pod", resource: "pods", namespaced: true},
		{name: "apps namespaced", group: "apps", version: "v1", kind: "Deployment", resource: "deployments", namespaced: true},
		{name: "core cluster", group: "", version: "v1", kind: "Node", resource: "nodes", namespaced: false},
		{name: "apiextensions cluster", group: "apiextensions.k8s.io", version: "v1", kind: "CustomResourceDefinition", resource: "customresourcedefinitions", namespaced: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			info, ok := lookupBuiltinResourceByGVK(tt.group, tt.version, tt.kind)
			if !ok {
				t.Fatalf("expected lookup to resolve %s/%s/%s", tt.group, tt.version, tt.kind)
			}
			if info.Group != tt.group || info.Version != tt.version || info.Kind != tt.kind || info.Resource != tt.resource || info.Namespaced != tt.namespaced {
				t.Fatalf("unexpected resource info: %+v", info)
			}
		})
	}
}

func TestLookupBuiltinResourceByGVKRejectsUnknownOrMismatchedVersion(t *testing.T) {
	if _, ok := lookupBuiltinResourceByGVK("example.com", "v1", "Widget"); ok {
		t.Fatalf("custom resource should not resolve through built-in catalog")
	}
	if _, ok := lookupBuiltinResourceByGVK("autoscaling", "v1", "HorizontalPodAutoscaler"); ok {
		t.Fatalf("mismatched built-in version should not resolve through GVK lookup")
	}
}

func TestBuiltinDetailCachePermissionKindsExistInBuiltinCatalog(t *testing.T) {
	for kind := range builtinDetailCachePermissionKinds {
		if _, ok := lookupBuiltinResourceByKind(kind); !ok {
			t.Fatalf("detail cache permission kind %q is missing from builtin catalog", kind)
		}
	}
}

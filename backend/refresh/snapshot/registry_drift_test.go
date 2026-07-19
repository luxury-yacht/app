package snapshot

import (
	"sort"
	"testing"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/kindspec"
)

// These are the drift guards for the two registry-driven subsystems in this
// package: the object map (collectors, gateway collectors, relationship edges, and
// graph roles) and the snapshot stream-summary typed-table domains. Both derive
// their kind sets purely from kindregistry.All by filtering on a facet, so they can
// never internally disagree with the registry — the real risk is a kind's facet
// being dropped (the kind silently leaves the object map / a typed table) or a new
// kind being added without wiring the facet. These tests pin each facet's kind set
// to an explicit golden list so either change fails loudly and must be made
// deliberately. The golden lists are independent string literals on purpose: they
// pin behaviour even if a kind's Identity.Kind is renamed. The literal kind names
// here are sanctioned — the resource-kind-registry contract exempts tests from the
// one-place-per-kind rule.

// assertKindSet fails unless got equals want as a set, reporting kinds that are
// missing (a facet was dropped) and kinds that are unexpected (a facet was added
// without updating this guard).
func assertKindSet(t testing.TB, name string, want, got []string) {
	t.Helper()
	wantSet := map[string]bool{}
	for _, k := range want {
		wantSet[k] = true
	}
	gotSet := map[string]bool{}
	for _, k := range got {
		gotSet[k] = true
	}
	var missing, extra []string
	for k := range wantSet {
		if !gotSet[k] {
			missing = append(missing, k)
		}
	}
	for k := range gotSet {
		if !wantSet[k] {
			extra = append(extra, k)
		}
	}
	sort.Strings(missing)
	sort.Strings(extra)
	if len(missing) > 0 {
		t.Errorf("%s: %v expected but the facet is missing from the registry (kind dropped from the subsystem)", name, missing)
	}
	if len(extra) > 0 {
		t.Errorf("%s: %v have the facet but are not in the expected set (update this guard deliberately)", name, extra)
	}
}

// registryKinds returns every registry kind for which pred is true.
func registryKinds(pred func(kindspec.Descriptor) bool) []string {
	var out []string
	for _, d := range kindregistry.All {
		if pred(d) {
			out = append(out, d.Identity.Kind)
		}
	}
	return out
}

func TestObjectMapCollectorKindsDoNotDrift(t *testing.T) {
	assertKindSet(t, "object-map collectors", []string{
		"ClusterRole", "ClusterRoleBinding", "ConfigMap", "CronJob", "DaemonSet",
		"Deployment", "EndpointSlice", "Ingress", "IngressClass", "Job",
		"NetworkPolicy", "Node", "PersistentVolume", "PersistentVolumeClaim", "Pod",
		"PodDisruptionBudget", "ReplicaSet", "Secret", "Service", "ServiceAccount",
		"StatefulSet", "StorageClass",
	}, registryKinds(func(d kindspec.Descriptor) bool { return d.Collector != nil }))
}

func TestObjectMapGatewayCollectorKindsDoNotDrift(t *testing.T) {
	assertKindSet(t, "object-map gateway collectors", []string{
		"BackendTLSPolicy", "GRPCRoute", "Gateway", "GatewayClass", "HTTPRoute",
		"ListenerSet", "ReferenceGrant", "TLSRoute",
	}, registryKinds(func(d kindspec.Descriptor) bool { return d.GatewayCollector != nil }))
}

func TestObjectMapEdgeKindsDoNotDrift(t *testing.T) {
	// HorizontalPodAutoscaler contributes edges but has no Collector (its v2 node
	// is projected bespoke from the autoscaling/v2 informer), so it appears here
	// but not in the collector guard.
	assertKindSet(t, "object-map edges", []string{
		"BackendTLSPolicy", "ClusterRole", "ClusterRoleBinding", "CronJob", "DaemonSet",
		"Deployment", "EndpointSlice", "GRPCRoute", "Gateway", "GatewayClass",
		"HTTPRoute", "HorizontalPodAutoscaler", "Ingress", "Job", "ListenerSet",
		"NetworkPolicy", "PersistentVolume", "PersistentVolumeClaim", "Pod",
		"PodDisruptionBudget", "ReferenceGrant", "ReplicaSet", "Service",
		"StatefulSet", "TLSRoute",
	}, registryKinds(func(d kindspec.Descriptor) bool { return d.Edges != nil }))
}

func TestObjectMapGraphRolesDoNotDrift(t *testing.T) {
	assertKindSet(t, "object-map scalable-workload role",
		[]string{"Deployment", "ReplicaSet", "StatefulSet"},
		registryKinds(func(d kindspec.Descriptor) bool { return d.Graph.ScalableWorkload }))

	assertKindSet(t, "object-map directional-traversal role", []string{
		"ConfigMap", "EndpointSlice", "IngressClass", "NetworkPolicy", "Node",
		"PersistentVolume", "PersistentVolumeClaim", "Pod", "PodDisruptionBudget",
		"Secret", "Service", "ServiceAccount", "StorageClass",
	}, registryKinds(func(d kindspec.Descriptor) bool { return d.Graph.DirectionalTraversal }))

	assertKindSet(t, "object-map stops-reverse-expansion role",
		[]string{"GatewayClass", "IngressClass", "StorageClass"},
		registryKinds(func(d kindspec.Descriptor) bool { return d.Graph.StopsReverseExpansion }))
}

func TestStreamSummaryDomainKindsDoNotDrift(t *testing.T) {
	// namespace-network also streams Service and EndpointSlice, but those are
	// hand-listed in namespace_network.go (a Service row aggregates its correlated
	// EndpointSlices, which a per-object StreamRow cannot carry), so they are
	// intentionally outside the registry-derived domain set guarded here.
	want := map[string][]string{
		"cluster-config":        {"GatewayClass", "IngressClass", "MutatingWebhookConfiguration", "StorageClass", "ValidatingWebhookConfiguration"},
		"cluster-rbac":          {"ClusterRole", "ClusterRoleBinding"},
		"cluster-storage":       {"PersistentVolume"},
		"namespace-autoscaling": {"HorizontalPodAutoscaler"},
		"namespace-config":      {"ConfigMap", "Secret"},
		"namespace-network":     {"BackendTLSPolicy", "GRPCRoute", "Gateway", "HTTPRoute", "Ingress", "ListenerSet", "NetworkPolicy", "ReferenceGrant", "TLSRoute"},
		"namespace-quotas":      {"LimitRange", "PodDisruptionBudget", "ResourceQuota"},
		"namespace-rbac":        {"Role", "RoleBinding", "ServiceAccount"},
		"namespace-storage":     {"PersistentVolumeClaim"},
	}
	got := map[string][]string{}
	for _, sd := range kindregistry.StreamDescriptors() {
		got[sd.Domain] = append(got[sd.Domain], sd.Kind)
	}
	for domain := range got {
		if _, ok := want[domain]; !ok {
			t.Errorf("stream domain %q is registry-driven but not in the expected map (update this guard deliberately)", domain)
		}
	}
	for domain, wantKinds := range want {
		assertKindSet(t, "stream domain "+domain, wantKinds, got[domain])
	}
}

func TestStreamCustomHandlerKindsDoNotDrift(t *testing.T) {
	// HPA keeps a bespoke live-stream handler over its autoscaling/v1 informer. The
	// snapshot side still streams it via the registry, so dropping the flag would
	// silently double-stream it — guard the set. ConfigMap/Secret previously carried
	// this flag only for their Helm-release refresh side-effect; that is now served by
	// the dedicated helm-storage source and the kinds are owned-reflector ingest kinds,
	// so their live notify comes from the generic ingest notify sink, not a custom
	// handler.
	assertKindSet(t, "custom stream handlers",
		[]string{"HorizontalPodAutoscaler"},
		registryKinds(func(d kindspec.Descriptor) bool { return d.Stream != nil && d.Stream.CustomStreamHandler }))
}

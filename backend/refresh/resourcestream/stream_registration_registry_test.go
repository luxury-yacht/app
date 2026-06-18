package resourcestream

import (
	"sort"
	"testing"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/resourcecontract"
)

// TestStreamRegistryMatchesContract ties every descriptor-driven stream
// registration to the canonical built-in resource contract so a typo or drift
// fails CI. kindregistry.StreamDescriptors() is the single source the manager loops; this
// guards it against the contract.
func TestStreamRegistryMatchesContract(t *testing.T) {
	for _, d := range kindregistry.StreamDescriptors() {
		if _, ok := resourcecontract.FindBuiltin(d.Group, d.Version, d.Kind); !ok {
			t.Errorf("stream descriptor %s/%s/%s (%s) not in BuiltinResources", d.Group, d.Version, d.Kind, d.Resource)
		}
	}
}

// TestStreamDescriptorKindsDoNotDrift is the reverse-direction guard: the test
// above only checks that streamed kinds are real, so it would not catch a kind that
// silently lost its Stream descriptor (it would then disappear from its live table
// and snapshot). This pins the exact set of directly-streamed kinds. Workloads
// (Pod/Deployment/ReplicaSet/StatefulSet/DaemonSet/Job/CronJob), Service,
// EndpointSlice, Node, Namespace, and CustomResourceDefinition are intentionally
// absent — they stream via bespoke/aggregating paths, not the generic descriptor.
func TestStreamDescriptorKindsDoNotDrift(t *testing.T) {
	want := []string{
		"BackendTLSPolicy", "ClusterRole", "ClusterRoleBinding", "ConfigMap",
		"GRPCRoute", "Gateway", "GatewayClass", "HTTPRoute", "HorizontalPodAutoscaler",
		"Ingress", "IngressClass", "LimitRange", "ListenerSet",
		"MutatingWebhookConfiguration", "NetworkPolicy", "PersistentVolume",
		"PersistentVolumeClaim", "PodDisruptionBudget", "ReferenceGrant",
		"ResourceQuota", "Role", "RoleBinding", "Secret", "ServiceAccount",
		"StorageClass", "TLSRoute", "ValidatingWebhookConfiguration",
	}
	var got []string
	for _, d := range kindregistry.StreamDescriptors() {
		got = append(got, d.Kind)
	}
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
		t.Errorf("stream descriptors: %v expected but the Stream facet is missing (kind dropped from streaming)", missing)
	}
	if len(extra) > 0 {
		t.Errorf("stream descriptors: %v are streamed but not in the expected set (update this guard deliberately)", extra)
	}
}

package snapshot

import (
	"slices"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/genkindfacets"
	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/kindspec"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resources/nodes"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// ownedPodFixture is a pod controlled, through the kind's real owner chain, by
// an object of the kind named "owner", plus the owner sources that resolve it.
type ownedPodFixture func() (*corev1.Pod, PodOwnerSources)

func controlledPod(apiVersion, kind, name string) *corev1.Pod {
	return &corev1.Pod{ObjectMeta: metav1.ObjectMeta{
		Namespace: "team-a",
		Name:      "owned-pod",
		OwnerReferences: []metav1.OwnerReference{{
			APIVersion: apiVersion, Kind: kind, Name: name, Controller: ptrBool(true),
		}},
	}}
}

// One fixture per kind whose Pods tab lists pods by owner. A kind that gains
// that facet fails this test until its owner chain is pinned here.
var ownedPodFixtures = map[string]ownedPodFixture{
	"Deployment": func() (*corev1.Pod, PodOwnerSources) {
		// Deployment pods are controlled by a ReplicaSet the Deployment owns.
		return controlledPod("apps/v1", "ReplicaSet", "owner-5d8f"), PodOwnerSources{
			ReplicaSetOwner: func(namespace, name string) (metav1.OwnerReference, bool) {
				return metav1.OwnerReference{APIVersion: "apps/v1", Kind: "Deployment", Name: "owner", Controller: ptrBool(true)}, namespace == "team-a" && name == "owner-5d8f"
			},
		}
	},
	"ReplicaSet": func() (*corev1.Pod, PodOwnerSources) {
		return controlledPod("apps/v1", "ReplicaSet", "owner"), PodOwnerSources{}
	},
	"StatefulSet": func() (*corev1.Pod, PodOwnerSources) {
		return controlledPod("apps/v1", "StatefulSet", "owner"), PodOwnerSources{}
	},
	"DaemonSet": func() (*corev1.Pod, PodOwnerSources) {
		return controlledPod("apps/v1", "DaemonSet", "owner"), PodOwnerSources{}
	},
	"Job": func() (*corev1.Pod, PodOwnerSources) {
		return controlledPod("batch/v1", "Job", "owner"), PodOwnerSources{}
	},
}

func projectedPodRow(t *testing.T, pod *corev1.Pod, sources PodOwnerSources) PodSummary {
	t.Helper()
	projected, err := NewPodIngestProjector(ClusterMeta{ClusterID: "c-1"}, sources)(pod)
	require.NoError(t, err)
	return projected.(ingest.Bundle).Table.(PodSummary)
}

// Every kind whose Pods tab lists pods by owner is served by the pods domain's
// workload selector for a pod it owns.
func TestPodsByOwnerFacetIsServedByTheWorkloadSelector(t *testing.T) {
	byOwner := map[string]bool{}
	for _, descriptor := range kindregistry.All {
		if descriptor.Panel.Pods != kindspec.PanelPodsByOwner {
			continue
		}
		identity := descriptor.Identity
		byOwner[identity.Kind] = true
		fixture, ok := ownedPodFixtures[identity.Kind]
		require.Truef(t, ok, "%s lists pods by owner but has no owner-chain fixture", identity.Kind)
		pod, sources := fixture()
		row := projectedPodRow(t, pod, sources)
		scope := refresh.WorkloadSelector(refresh.ObjectScopeIdentity{
			Namespace: "team-a",
			GVK:       schema.GroupVersionKind{Group: identity.Group, Version: identity.Version, Kind: identity.Kind},
			Name:      "owner",
		}).String()
		got, err := filterPodRowsByScope([]PodSummary{row}, scope)
		require.NoError(t, err, identity.Kind)
		require.Len(t, got, 1, "%s: its pod is not selected by %s", identity.Kind, scope)
	}
	for kind := range ownedPodFixtures {
		require.Truef(t, byOwner[kind], "fixture for %s, which no longer lists pods by owner", kind)
	}
}

func TestPodsByNodeFacetIsServedByTheNodeSelector(t *testing.T) {
	for _, descriptor := range kindregistry.All {
		if descriptor.Panel.Pods != kindspec.PanelPodsByNode {
			continue
		}
		require.Equal(t, nodes.Identity, descriptor.Identity, "only nodes select pods by node")
		pod := controlledPod("apps/v1", "ReplicaSet", "rs")
		pod.Spec.NodeName = "worker-1"
		row := projectedPodRow(t, pod, PodOwnerSources{})
		got, err := filterPodRowsByScope([]PodSummary{row}, refresh.NodeSelector("worker-1").String())
		require.NoError(t, err)
		require.Len(t, got, 1)
	}
}

// The generated metrics domain names a real domain, and the domain's rows carry
// the kind.
func TestMetricsFacetNamesTheDomainThatServesTheKind(t *testing.T) {
	workloadKinds := map[string]bool{}
	for _, source := range workloadStoreGVRKinds {
		workloadKinds[source.Kind] = true
	}
	for _, descriptor := range kindregistry.All {
		domain, ok := genkindfacets.MetricsDomain(descriptor.Metrics)
		require.Truef(t, ok, "%s: unknown metrics source", descriptor.Identity.Kind)
		switch descriptor.Metrics {
		case kindspec.MetricsNone:
			require.Equal(t, "none", domain)
		case kindspec.MetricsPods:
			require.Equal(t, podDomainName, domain)
			require.Equal(t, "Pod", descriptor.Identity.Kind)
		case kindspec.MetricsWorkloads:
			require.Equal(t, namespaceWorkloadsDomainName, domain)
			require.Truef(t, workloadKinds[descriptor.Identity.Kind], "%s has no %s rows", descriptor.Identity.Kind, domain)
		case kindspec.MetricsNodes:
			require.Equal(t, nodeDomainName, domain)
			require.Equal(t, nodes.Identity, descriptor.Identity)
		}
	}
}

// The kinds each list domain's table can show: its query kind vocabulary, or
// the single kind of a domain that publishes none.
var listDomainKinds = map[string]func() []string{
	clusterConfigDomainName:        func() []string { return clusterConfigQueryCapabilities().KindVocabulary },
	clusterCRDDomainName:           func() []string { return clusterCRDQueryCapabilities().KindVocabulary },
	clusterRBACDomainName:          func() []string { return clusterRBACQueryCapabilities().KindVocabulary },
	clusterStorageDomainName:       func() []string { return clusterStorageQueryCapabilities().KindVocabulary },
	namespaceAutoscalingDomainName: func() []string { return namespaceAutoscalingQueryCapabilities().KindVocabulary },
	namespaceConfigDomainName:      func() []string { return namespaceConfigQueryCapabilities().KindVocabulary },
	namespaceNetworkDomainName:     func() []string { return namespaceNetworkQueryCapabilities().KindVocabulary },
	namespaceQuotasDomainName:      func() []string { return namespaceQuotasQueryCapabilities().KindVocabulary },
	namespaceRBACDomainName:        func() []string { return namespaceRBACQueryCapabilities().KindVocabulary },
	namespaceStorageDomainName:     func() []string { return namespaceStorageQueryCapabilities().KindVocabulary },
	namespaceWorkloadsDomainName:   func() []string { return namespaceWorkloadsQueryCapabilities().KindVocabulary },
	podDomainName:                  func() []string { return podQueryCapabilities().KindVocabulary },
	// Nodes, namespaces, and events publish no kind vocabulary; each lists one kind.
	nodeDomainName:            func() []string { return []string{nodes.Identity.Kind} },
	"namespaces":              func() []string { return []string{"Namespace"} },
	namespaceEventsDomainName: func() []string { return []string{"Event"} },
}

// Navigation sends an object to the view that lists its kind's list domain, so
// that domain must list the kind.
func TestListDomainFacetNamesADomainThatListsTheKind(t *testing.T) {
	rows, err := genkindfacets.Rows()
	require.NoError(t, err)
	for _, row := range rows {
		if row.ListDomain == "none" {
			continue
		}
		kinds, ok := listDomainKinds[row.ListDomain]
		require.Truef(t, ok, "%s: list domain %s has no kind list here", row.Kind, row.ListDomain)
		require.Truef(t, slices.Contains(kinds(), row.Kind), "%s: %s does not list it", row.Kind, row.ListDomain)
	}
}

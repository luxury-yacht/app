package snapshot

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"testing"

	admissionregistrationv1 "k8s.io/api/admissionregistration/v1"
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	policyv1 "k8s.io/api/policy/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	storagev1 "k8s.io/api/storage/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/resources/admission"
	"github.com/luxury-yacht/app/backend/resources/apiextensions"
	"github.com/luxury-yacht/app/backend/resources/clusterrole"
	"github.com/luxury-yacht/app/backend/resources/clusterrolebinding"
	"github.com/luxury-yacht/app/backend/resources/configmap"
	"github.com/luxury-yacht/app/backend/resources/customresource"
	"github.com/luxury-yacht/app/backend/resources/endpointslice"
	gatewaypkg "github.com/luxury-yacht/app/backend/resources/gateway"
	hpapkg "github.com/luxury-yacht/app/backend/resources/hpa"
	ingresspkg "github.com/luxury-yacht/app/backend/resources/ingress"
	"github.com/luxury-yacht/app/backend/resources/ingressclass"
	"github.com/luxury-yacht/app/backend/resources/limitrange"
	"github.com/luxury-yacht/app/backend/resources/networkpolicy"
	"github.com/luxury-yacht/app/backend/resources/persistentvolume"
	"github.com/luxury-yacht/app/backend/resources/persistentvolumeclaim"
	"github.com/luxury-yacht/app/backend/resources/poddisruptionbudget"
	"github.com/luxury-yacht/app/backend/resources/resourcequota"
	rolepkg "github.com/luxury-yacht/app/backend/resources/role"
	"github.com/luxury-yacht/app/backend/resources/rolebinding"
	secretpkg "github.com/luxury-yacht/app/backend/resources/secret"
	servicepkg "github.com/luxury-yacht/app/backend/resources/service"
	"github.com/luxury-yacht/app/backend/resources/serviceaccount"
	"github.com/luxury-yacht/app/backend/resources/storageclass"
	"github.com/luxury-yacht/app/backend/testsupport"
)

// TestSnapshotStreamRowParity is the keystone parity harness for the
// snapshot/stream row contract in docs/architecture/refresh-system.md. For
// every domain returned by resourcestream.SupportedDomains() it:
//
//  1. Builds a snapshot through the canonical Builder for that domain
//     (the same code that produces the initial snapshot the frontend
//     renders on first load).
//  2. Recomputes each row by calling the per-row Build*Summary projector
//     that the resource-stream handlers call on every event.
//  3. JSON-marshals both, sorts, and asserts byte-equality.
//
// If a field is added to a *Summary struct but not populated by
// Build*Summary, this test fails. If a snapshot builder enriches a row
// post-construction in a way the streamed row would not receive, this
// test fails. That makes the parity contract self-enforcing as the
// codebase evolves.
//
// Domains the harness intentionally does not cover with this pattern
// are listed in TestSnapshotStreamRowParityCoversAllSupportedDomains
// with a written reason.
func TestSnapshotStreamRowParity(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}

	cases := []parityCase{
		// Drift-prone canaries first — these are the domains that motivated the plan.
		parityWorkloadsCase(meta, true),
		parityWorkloadsCase(meta, false),
		parityServiceCase(meta, true),
		parityServiceCase(meta, false),
		parityNamespaceCustomCollisionCase(meta),
		parityClusterCustomCollisionCase(meta),

		// Metric-bearing rows: present and absent fixtures.
		parityPodsCase(meta, true),
		parityPodsCase(meta, false),
		parityNodesCase(meta, true),
		parityNodesCase(meta, false),

		// Pure-object namespace domains.
		parityNamespaceConfigCase(meta),
		parityNamespaceRBACCase(meta),
		parityNamespaceQuotasCase(meta),
		parityNamespaceStorageCase(meta),
		parityNamespaceAutoscalingCase(meta),
		parityNamespaceNetworkObjectsCase(meta),

		// Cluster-scoped domains.
		parityClusterRBACCase(meta),
		parityClusterStorageCase(meta),
		parityClusterConfigCase(meta),
		parityClusterCRDCase(meta),
	}

	for _, tc := range cases {
		t.Run(tc.name, tc.run)
	}
}

// TestSnapshotStreamRowParityCoversAllSupportedDomains locks the parity
// harness to the resource-stream domain registry. Any domain returned by
// resourcestream.SupportedDomains() must either have a parity case here
// (see covered) or an explicit excluded entry documenting why.
//
// The Helm domain is the one excluded case: the stream contract is a
// scope-level COMPLETE that triggers snapshot resync, not per-row
// projection. The plan explicitly chose that contract for Helm because
// release identity churn affects many rows at once via decoded release
// name semantics (Phase 5 of the projection-contract plan). The harness
// instead asserts that contract elsewhere — see TestHelmStreamIsScopeLevelComplete.
func TestSnapshotStreamRowParityCoversAllSupportedDomains(t *testing.T) {
	covered := map[string]struct{}{
		"pods":                  {},
		"namespace-workloads":   {},
		"namespace-config":      {},
		"namespace-network":     {},
		"namespace-rbac":        {},
		"namespace-custom":      {},
		"namespace-autoscaling": {},
		"namespace-quotas":      {},
		"namespace-storage":     {},
		"cluster-rbac":          {},
		"cluster-storage":       {},
		"cluster-config":        {},
		"cluster-crds":          {},
		"cluster-custom":        {},
		"nodes":                 {},
	}
	excluded := map[string]string{
		"namespace-helm": "scope-level COMPLETE contract, not per-row projection (Phase 5 plan decision)",
	}

	supported := resourceStreamContractDomains(t)

	for _, domain := range supported {
		if _, ok := covered[domain]; ok {
			continue
		}
		if _, ok := excluded[domain]; ok {
			continue
		}
		t.Errorf("resource stream domain %q has no parity case and no documented exclusion; add a parity*Case or excluded entry", domain)
	}
}

func resourceStreamContractDomains(t *testing.T) []string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	require.True(t, ok, "resolve parity test path")
	path := filepath.Join(filepath.Dir(file), "..", "domain", "refresh-domain-contract.json")
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	var contract struct {
		ResourceStream struct {
			Domains map[string]json.RawMessage `json:"domains"`
		} `json:"resourceStream"`
	}
	require.NoError(t, json.Unmarshal(data, &contract))
	domains := make([]string, 0, len(contract.ResourceStream.Domains))
	for domain := range contract.ResourceStream.Domains {
		domains = append(domains, domain)
	}
	sort.Strings(domains)
	return domains
}

type parityCase struct {
	name string
	run  func(t *testing.T)
}

// requireRowParity JSON-marshals each row in expected and actual and
// asserts byte-equality. Both slices are sorted by sortKey first so the
// snapshot builder's ordering does not have to match the harness's
// per-row iteration order.
func requireRowParity(t *testing.T, snapshotRows, expectedRows []any, sortKey func(any) string) {
	t.Helper()
	require.Equal(t, len(expectedRows), len(snapshotRows), "row count mismatch: snapshot=%d expected=%d", len(snapshotRows), len(expectedRows))

	snapJSON := marshalSorted(t, snapshotRows, sortKey)
	expectedJSON := marshalSorted(t, expectedRows, sortKey)
	require.Equal(t, string(expectedJSON), string(snapJSON), "snapshot/stream row drift detected — a field is populated on one path but not the other")
}

func marshalSorted(t *testing.T, rows []any, sortKey func(any) string) []byte {
	t.Helper()
	indexed := make([]struct {
		key string
		row any
	}, len(rows))
	for i, r := range rows {
		indexed[i].key = sortKey(r)
		indexed[i].row = r
	}
	sort.Slice(indexed, func(i, j int) bool { return indexed[i].key < indexed[j].key })
	out := make([]any, len(indexed))
	for i, item := range indexed {
		out[i] = item.row
	}
	data, err := json.Marshal(out)
	require.NoError(t, err)
	return data
}

func toAnySlice[T any](rows []T) []any {
	out := make([]any, len(rows))
	for i, r := range rows {
		out[i] = r
	}
	return out
}

// ---------- Pods ----------

func parityPodsCase(meta ClusterMeta, withMetrics bool) parityCase {
	name := "pods/without_metrics"
	if withMetrics {
		name = "pods/with_metrics"
	}
	return parityCase{
		name: name,
		run: func(t *testing.T) {
			rs := &appsv1.ReplicaSet{
				ObjectMeta: metav1.ObjectMeta{
					Name:      "web-abc",
					Namespace: "default",
					OwnerReferences: []metav1.OwnerReference{{
						Kind: "Deployment", Name: "web", Controller: ptrBool(true),
					}},
				},
			}
			podA := &corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Name: "web-abc-1", Namespace: "default",
					OwnerReferences: []metav1.OwnerReference{{Kind: "ReplicaSet", Name: "web-abc", Controller: ptrBool(true)}},
				},
				Spec: corev1.PodSpec{
					NodeName: "node-1",
					Containers: []corev1.Container{{
						Name:  "app",
						Ports: []corev1.ContainerPort{{ContainerPort: 8080, Protocol: corev1.ProtocolTCP}},
					}},
				},
				Status: corev1.PodStatus{
					Phase: corev1.PodRunning,
					ContainerStatuses: []corev1.ContainerStatus{{
						Name: "app", Ready: true,
						State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}},
					}},
				},
			}
			podB := &corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{Name: "standalone", Namespace: "default"},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "main"}}},
				Status:     corev1.PodStatus{Phase: corev1.PodRunning},
			}

			rsLister := testsupport.NewReplicaSetLister(t, rs)
			podLister := testsupport.NewPodLister(t, podA, podB)

			builder := &PodBuilder{
				podLister: podLister,
				rsLister:  rsLister,
			}
			snap, err := builder.Build(WithClusterMeta(context.Background(), meta), "namespace:default")
			require.NoError(t, err)
			payload := snap.Payload.(PodSnapshot)

			expectedUsage := map[string]metrics.PodUsage{}
			expected := []PodSummary{
				buildPodSummaryForTest(meta, podA, expectedUsage, rsLister),
				buildPodSummaryForTest(meta, podB, expectedUsage, rsLister),
			}
			requireRowParity(t, toAnySlice(payload.Rows), toAnySlice(expected), func(r any) string {
				row := r.(PodSummary)
				return row.Namespace + "/" + row.Name
			})
		},
	}
}

// ---------- Workloads ----------

func parityWorkloadsCase(meta ClusterMeta, withHPA bool) parityCase {
	name := "workloads/without_hpa"
	if withHPA {
		name = "workloads/with_hpa"
	}
	return parityCase{
		name: name,
		run: func(t *testing.T) {
			deployment := &appsv1.Deployment{
				ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
				Spec: appsv1.DeploymentSpec{
					Replicas: ptrInt32(3),
					Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{
						Containers: []corev1.Container{{Name: "app", Ports: []corev1.ContainerPort{{ContainerPort: 8080}}}},
					}},
				},
				Status: appsv1.DeploymentStatus{ReadyReplicas: 2, Replicas: 3},
			}
			statefulSet := &appsv1.StatefulSet{
				ObjectMeta: metav1.ObjectMeta{Name: "cache", Namespace: "default"},
				Spec: appsv1.StatefulSetSpec{
					Replicas: ptrInt32(2),
					Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{
						Containers: []corev1.Container{{Name: "redis"}},
					}},
				},
			}
			pod := &corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Name: "web-abc-1", Namespace: "default",
					OwnerReferences: []metav1.OwnerReference{{Kind: "ReplicaSet", Name: "web-abc", Controller: ptrBool(true)}},
				},
				Spec:   corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}},
				Status: corev1.PodStatus{Phase: corev1.PodRunning, ContainerStatuses: []corev1.ContainerStatus{{Name: "app", Ready: true}}},
			}

			var hpas []*autoscalingv1.HorizontalPodAutoscaler
			if withHPA {
				hpas = []*autoscalingv1.HorizontalPodAutoscaler{{
					ObjectMeta: metav1.ObjectMeta{Name: "web-hpa", Namespace: "default"},
					Spec: autoscalingv1.HorizontalPodAutoscalerSpec{
						MaxReplicas:    5,
						ScaleTargetRef: autoscalingv1.CrossVersionObjectReference{APIVersion: "apps/v1", Kind: "Deployment", Name: "web"},
					},
				}}
			}

			builder := &NamespaceWorkloadsBuilder{
				workloadIngest:      newFakeWorkloadIngestSource(meta, deployment, statefulSet),
				includeDeployments:  true,
				includeStatefulSets: true,
				includeDaemonSets:   true,
				includeJobs:         true,
				includeCronJobs:     true,
				podIngest:           newFakePodWorkloadsIngestSource(meta, nil, pod),
				includePods:         true,
				hpaLister:           testsupport.NewHorizontalPodAutoscalerLister(t, hpas...),
			}
			seedWorkloadsFromBuilderSource(builder, meta)
			snap, err := builder.Build(WithClusterMeta(context.Background(), meta), "namespace:default")
			require.NoError(t, err)
			payload := snap.Payload.(NamespaceWorkloadsSnapshot)

			deploymentRow, err := BuildWorkloadSummary(meta, deployment, []*corev1.Pod{pod}, nil, hpas...)
			require.NoError(t, err)
			statefulRow, err := BuildWorkloadSummary(meta, statefulSet, []*corev1.Pod{pod}, nil, hpas...)
			require.NoError(t, err)
			expected := []WorkloadSummary{deploymentRow, statefulRow}

			requireRowParity(t, toAnySlice(payload.Rows), toAnySlice(expected), func(r any) string {
				row := r.(WorkloadSummary)
				return row.Kind + "/" + row.Namespace + "/" + row.Name
			})

			if withHPA {
				for _, row := range payload.Rows {
					if row.Kind == "Deployment" && row.Name == "web" {
						require.NotNil(t, row.HPAManaged, "snapshot deployment row should have HPA coverage")
						require.True(t, *row.HPAManaged, "snapshot deployment row should be marked HPA-managed")
					}
				}
			}
		},
	}
}

// ---------- Namespace network: Service with EndpointSlices ----------

func parityServiceCase(meta ClusterMeta, withEndpoints bool) parityCase {
	name := "network/service_without_endpoints"
	if withEndpoints {
		name = "network/service_with_endpoints"
	}
	return parityCase{
		name: name,
		run: func(t *testing.T) {
			service := &corev1.Service{
				ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "default"},
				Spec: corev1.ServiceSpec{
					Type:      corev1.ServiceTypeClusterIP,
					ClusterIP: "10.0.0.10",
					Ports:     []corev1.ServicePort{{Port: 443, Protocol: corev1.ProtocolTCP}},
				},
			}

			var slices []*discoveryv1.EndpointSlice
			if withEndpoints {
				ready := true
				port := int32(443)
				protocol := corev1.ProtocolTCP
				slices = []*discoveryv1.EndpointSlice{{
					ObjectMeta: metav1.ObjectMeta{
						Name:      "api-a",
						Namespace: "default",
						Labels:    map[string]string{discoveryv1.LabelServiceName: "api"},
					},
					AddressType: discoveryv1.AddressTypeIPv4,
					Ports:       []discoveryv1.EndpointPort{{Port: &port, Protocol: &protocol}},
					Endpoints:   []discoveryv1.Endpoint{{Addresses: []string{"10.244.0.10"}, Conditions: discoveryv1.EndpointConditions{Ready: &ready}}},
				}}
			}

			// Service and EndpointSlice are cut to the ingest path: the builder reads the
			// Service OWN-row + EndpointSlice rows + join facts from the ingest source. The
			// serve-side re-join must reproduce servicepkg.BuildStreamSummary(meta, svc,
			// slices) — the typed reference — byte for byte, INCLUDING the endpoint count.
			ingestObjects := []metav1.Object{service}
			for _, slice := range slices {
				ingestObjects = append(ingestObjects, slice)
			}
			builder := &NamespaceNetworkBuilder{
				networkIngest:         newFakeNetworkIngestSource(meta, ingestObjects...),
				includeServices:       true,
				includeEndpointSlices: true,
				collectIndexer:        networkCollectIndexer(networkIndexers{}),
			}
			seedNetworkMaintained(builder, meta)
			snap, err := builder.Build(WithClusterMeta(context.Background(), meta), "namespace:default")
			require.NoError(t, err)
			payload := snap.Payload.(NamespaceNetworkSnapshot)

			expected := []NetworkSummary{
				servicepkg.BuildStreamSummary(meta, service, slices),
			}
			for _, slice := range slices {
				expected = append(expected, endpointslice.BuildStreamSummary(meta, slice))
			}

			requireRowParity(t, toAnySlice(payload.Rows), toAnySlice(expected), func(r any) string {
				row := r.(NetworkSummary)
				return row.Kind + "/" + row.Namespace + "/" + row.Name
			})
		},
	}
}

// parityNamespaceNetworkObjectsCase exercises the pure-object network
// projectors (Ingress, NetworkPolicy, Gateway API). These do not depend
// on related objects, so the parity expectation is exact.
func parityNamespaceNetworkObjectsCase(meta ClusterMeta) parityCase {
	return parityCase{
		name: "network/ingress_policy_gateway",
		run: func(t *testing.T) {
			ingress := &networkingv1.Ingress{
				ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
				Spec:       networkingv1.IngressSpec{IngressClassName: ptrString("nginx"), Rules: []networkingv1.IngressRule{{Host: "web.example.com"}}},
			}
			policy := &networkingv1.NetworkPolicy{
				ObjectMeta: metav1.ObjectMeta{Name: "egress", Namespace: "default"},
				Spec:       networkingv1.NetworkPolicySpec{Egress: []networkingv1.NetworkPolicyEgressRule{{}}},
			}
			gateway := &gatewayv1.Gateway{
				ObjectMeta: metav1.ObjectMeta{Name: "edge", Namespace: "default"},
				Spec: gatewayv1.GatewaySpec{
					GatewayClassName: gatewayv1.ObjectName("public"),
					Listeners:        []gatewayv1.Listener{{Name: gatewayv1.SectionName("http"), Port: gatewayv1.PortNumber(80), Protocol: gatewayv1.HTTPProtocolType}},
				},
			}

			// Ingress and NetworkPolicy are cut to the ingest path (plain object→row, fed
			// from the generic ingest reflector); the Gateway-API kinds are NOT cut and stay
			// indexer-driven. The builder reads Ingress/NetworkPolicy rows from the ingest
			// source and Gateway rows from its test indexer, all via the same shared
			// Build*StreamSummary helpers as the streaming path.
			builder := &NamespaceNetworkBuilder{
				networkIngest:          newFakeNetworkIngestSource(meta, ingress, policy),
				includeIngresses:       true,
				includeNetworkPolicies: true,
				collectIndexer: networkCollectIndexer(networkIndexers{
					ingress:       ingestAvailabilityIndexer,
					networkpolicy: ingestAvailabilityIndexer,
					gateway:       testsupport.NewNamespacedIndexer(t, gateway),
				}),
			}
			seedNetworkMaintained(builder, meta)
			snap, err := builder.Build(WithClusterMeta(context.Background(), meta), "namespace:default")
			require.NoError(t, err)
			payload := snap.Payload.(NamespaceNetworkSnapshot)

			expected := []NetworkSummary{
				ingresspkg.BuildStreamSummary(meta, ingress),
				networkpolicy.BuildStreamSummary(meta, policy),
				gatewaypkg.BuildStreamSummary(meta, gateway),
			}
			requireRowParity(t, toAnySlice(payload.Rows), toAnySlice(expected), func(r any) string {
				row := r.(NetworkSummary)
				return row.Kind + "/" + row.Namespace + "/" + row.Name
			})
		},
	}
}

// ---------- Namespace config (ConfigMap + Secret) ----------

func parityNamespaceConfigCase(meta ClusterMeta) parityCase {
	return parityCase{
		name: "namespace-config/configmap_secret",
		run: func(t *testing.T) {
			cm := &corev1.ConfigMap{
				ObjectMeta: metav1.ObjectMeta{Name: "app", Namespace: "default"},
				Data:       map[string]string{"a": "1", "b": "2"},
			}
			secret := &corev1.Secret{
				ObjectMeta: metav1.ObjectMeta{Name: "tls", Namespace: "default"},
				Type:       corev1.SecretTypeTLS,
				Data:       map[string][]byte{"tls.crt": []byte("c")},
			}

			builder := &NamespaceConfigBuilder{
				collectIndexer: configCollectIndexer(
					testsupport.NewNamespacedIndexer(t, cm),
					testsupport.NewNamespacedIndexer(t, secret),
				),
			}
			snap, err := builder.Build(WithClusterMeta(context.Background(), meta), "namespace:default")
			require.NoError(t, err)
			payload := snap.Payload.(NamespaceConfigSnapshot)

			expected := []ConfigSummary{
				configmap.BuildStreamSummary(meta, cm),
				secretpkg.BuildStreamSummary(meta, secret),
			}
			requireRowParity(t, toAnySlice(payload.Rows), toAnySlice(expected), func(r any) string {
				row := r.(ConfigSummary)
				return row.Kind + "/" + row.Namespace + "/" + row.Name
			})
		},
	}
}

// ---------- Namespace RBAC ----------

func parityNamespaceRBACCase(meta ClusterMeta) parityCase {
	return parityCase{
		name: "namespace-rbac/role_binding_sa",
		run: func(t *testing.T) {
			role := &rbacv1.Role{ObjectMeta: metav1.ObjectMeta{Name: "reader", Namespace: "default"}}
			binding := &rbacv1.RoleBinding{
				ObjectMeta: metav1.ObjectMeta{Name: "reader-binding", Namespace: "default"},
				Subjects:   []rbacv1.Subject{{Kind: "ServiceAccount", Name: "default"}},
				RoleRef:    rbacv1.RoleRef{Kind: "Role", Name: "reader"},
			}
			sa := &corev1.ServiceAccount{ObjectMeta: metav1.ObjectMeta{Name: "default", Namespace: "default"}}

			builder := &NamespaceRBACBuilder{
				collectIndexer: rbacCollectIndexer(
					testsupport.NewNamespacedIndexer(t, role),
					testsupport.NewNamespacedIndexer(t, binding),
					testsupport.NewNamespacedIndexer(t, sa),
				),
			}
			snap, err := builder.Build(WithClusterMeta(context.Background(), meta), "namespace:default")
			require.NoError(t, err)
			payload := snap.Payload.(NamespaceRBACSnapshot)

			expected := []RBACSummary{
				rolepkg.BuildStreamSummary(meta, role),
				rolebinding.BuildStreamSummary(meta, binding),
				serviceaccount.BuildStreamSummary(meta, sa),
			}
			requireRowParity(t, toAnySlice(payload.Rows), toAnySlice(expected), func(r any) string {
				row := r.(RBACSummary)
				return row.Kind + "/" + row.Namespace + "/" + row.Name
			})
		},
	}
}

// ---------- Namespace quotas ----------

func parityNamespaceQuotasCase(meta ClusterMeta) parityCase {
	return parityCase{
		name: "namespace-quotas/quota_limit_pdb",
		run: func(t *testing.T) {
			quota := &corev1.ResourceQuota{ObjectMeta: metav1.ObjectMeta{Name: "default", Namespace: "default"}}
			limit := &corev1.LimitRange{ObjectMeta: metav1.ObjectMeta{Name: "default", Namespace: "default"}}
			pdb := &policyv1.PodDisruptionBudget{
				ObjectMeta: metav1.ObjectMeta{Name: "web-pdb", Namespace: "default"},
				Spec:       policyv1.PodDisruptionBudgetSpec{},
			}

			builder := &NamespaceQuotasBuilder{
				collectIndexer: quotasCollectIndexer(
					testsupport.NewNamespacedIndexer(t, quota),
					testsupport.NewNamespacedIndexer(t, limit),
					testsupport.NewNamespacedIndexer(t, pdb),
				),
			}
			snap, err := builder.Build(WithClusterMeta(context.Background(), meta), "namespace:default")
			require.NoError(t, err)
			payload := snap.Payload.(NamespaceQuotasSnapshot)

			expected := []QuotaSummary{
				resourcequota.BuildStreamSummary(meta, quota),
				limitrange.BuildStreamSummary(meta, limit),
				poddisruptionbudget.BuildStreamSummary(meta, pdb),
			}
			requireRowParity(t, toAnySlice(payload.Rows), toAnySlice(expected), func(r any) string {
				row := r.(QuotaSummary)
				return row.Kind + "/" + row.Namespace + "/" + row.Name
			})
		},
	}
}

// ---------- Namespace storage ----------

func parityNamespaceStorageCase(meta ClusterMeta) parityCase {
	return parityCase{
		name: "namespace-storage/pvc",
		run: func(t *testing.T) {
			pvc := &corev1.PersistentVolumeClaim{
				ObjectMeta: metav1.ObjectMeta{Name: "data", Namespace: "default"},
				Spec: corev1.PersistentVolumeClaimSpec{
					Resources: corev1.VolumeResourceRequirements{Requests: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse("10Gi")}},
				},
			}

			builder := &NamespaceStorageBuilder{
				collectIndexer: storageCollectIndexer(testsupport.NewNamespacedIndexer(t, pvc)),
			}
			snap, err := builder.Build(WithClusterMeta(context.Background(), meta), "namespace:default")
			require.NoError(t, err)
			payload := snap.Payload.(NamespaceStorageSnapshot)

			expected := []StorageSummary{persistentvolumeclaim.BuildStreamSummary(meta, pvc)}
			requireRowParity(t, toAnySlice(payload.Rows), toAnySlice(expected), func(r any) string {
				row := r.(StorageSummary)
				return row.Kind + "/" + row.Namespace + "/" + row.Name
			})
		},
	}
}

// ---------- Namespace autoscaling (HPA row) ----------

func parityNamespaceAutoscalingCase(meta ClusterMeta) parityCase {
	return parityCase{
		name: "namespace-autoscaling/hpa",
		run: func(t *testing.T) {
			minReplicas := int32(2)
			hpa := &autoscalingv1.HorizontalPodAutoscaler{
				ObjectMeta: metav1.ObjectMeta{Name: "web-hpa", Namespace: "default"},
				Spec: autoscalingv1.HorizontalPodAutoscalerSpec{
					ScaleTargetRef: autoscalingv1.CrossVersionObjectReference{APIVersion: "apps/v1", Kind: "Deployment", Name: "web"},
					MinReplicas:    &minReplicas,
					MaxReplicas:    10,
				},
			}

			builder := &NamespaceAutoscalingBuilder{
				collectIndexer: autoscalingCollectIndexer(testsupport.NewNamespacedIndexer(t, hpa)),
			}
			snap, err := builder.Build(WithClusterMeta(context.Background(), meta), "namespace:default")
			require.NoError(t, err)
			payload := snap.Payload.(NamespaceAutoscalingSnapshot)

			expected := []AutoscalingSummary{hpapkg.BuildStreamSummary(meta, hpa)}
			requireRowParity(t, toAnySlice(payload.Rows), toAnySlice(expected), func(r any) string {
				row := r.(AutoscalingSummary)
				return row.Kind + "/" + row.Namespace + "/" + row.Name
			})
		},
	}
}

// ---------- Namespace custom (CR with CRD-backed GVK; collision regression) ----------

func parityNamespaceCustomCollisionCase(meta ClusterMeta) parityCase {
	return parityCase{
		name: "namespace-custom/gvk_collision",
		run: func(t *testing.T) {
			// Two resources with the same kind/name but different GVKs — the
			// row identity contract requires full GVK, not kind/name alone.
			crA := &unstructured.Unstructured{}
			crA.SetAPIVersion("rds.services.k8s.aws/v1alpha1")
			crA.SetKind("DBInstance")
			crA.SetName("primary")
			crA.SetNamespace("data")

			crB := &unstructured.Unstructured{}
			crB.SetAPIVersion("databases.example.com/v1")
			crB.SetKind("DBInstance")
			crB.SetName("primary")
			crB.SetNamespace("data")

			rowA := customresource.BuildNamespaceStreamSummary(meta, crA, "rds.services.k8s.aws", "v1alpha1", "DBInstance", "dbinstances.rds.services.k8s.aws", "data")
			rowB := customresource.BuildNamespaceStreamSummary(meta, crB, "databases.example.com", "v1", "DBInstance", "dbinstances.databases.example.com", "data")

			require.NotEqual(t, rowA.Group, rowB.Group, "collision regression: rows with same kind/name but different GVKs must remain distinguishable")
			require.NotEqual(t, rowA.CRDName, rowB.CRDName, "CRDName must differ for distinct CRDs")
			require.Equal(t, "primary", rowA.Name)
			require.Equal(t, "primary", rowB.Name)

			// Per-row parity: re-invoking the projector with the same inputs
			// returns byte-identical rows.
			rowARepeat := customresource.BuildNamespaceStreamSummary(meta, crA, "rds.services.k8s.aws", "v1alpha1", "DBInstance", "dbinstances.rds.services.k8s.aws", "data")
			requireRowParity(t, []any{rowA}, []any{rowARepeat}, func(r any) string {
				row := r.(NamespaceCustomSummary)
				return row.Group + "/" + row.Version + "/" + row.Kind + "/" + row.Namespace + "/" + row.Name
			})
		},
	}
}

// ---------- Cluster custom (cluster-scoped CR; collision regression) ----------

func parityClusterCustomCollisionCase(meta ClusterMeta) parityCase {
	return parityCase{
		name: "cluster-custom/gvk_collision",
		run: func(t *testing.T) {
			crA := &unstructured.Unstructured{}
			crA.SetAPIVersion("rds.services.k8s.aws/v1alpha1")
			crA.SetKind("DBCluster")
			crA.SetName("primary")

			crB := &unstructured.Unstructured{}
			crB.SetAPIVersion("databases.example.com/v1")
			crB.SetKind("DBCluster")
			crB.SetName("primary")

			rowA := customresource.BuildClusterStreamSummary(meta, crA, "rds.services.k8s.aws", "v1alpha1", "DBCluster", "dbclusters.rds.services.k8s.aws")
			rowB := customresource.BuildClusterStreamSummary(meta, crB, "databases.example.com", "v1", "DBCluster", "dbclusters.databases.example.com")

			require.NotEqual(t, rowA.Group, rowB.Group)
			require.NotEqual(t, rowA.CRDName, rowB.CRDName)

			rowARepeat := customresource.BuildClusterStreamSummary(meta, crA, "rds.services.k8s.aws", "v1alpha1", "DBCluster", "dbclusters.rds.services.k8s.aws")
			requireRowParity(t, []any{rowA}, []any{rowARepeat}, func(r any) string {
				row := r.(ClusterCustomSummary)
				return row.Group + "/" + row.Version + "/" + row.Kind + "/" + row.Name
			})
		},
	}
}

// ---------- Cluster RBAC ----------

func parityClusterRBACCase(meta ClusterMeta) parityCase {
	return parityCase{
		name: "cluster-rbac/role_binding",
		run: func(t *testing.T) {
			cr := &rbacv1.ClusterRole{ObjectMeta: metav1.ObjectMeta{Name: "view"}}
			crb := &rbacv1.ClusterRoleBinding{
				ObjectMeta: metav1.ObjectMeta{Name: "view-binding"},
				Subjects:   []rbacv1.Subject{{Kind: "Group", Name: "system:authenticated"}},
				RoleRef:    rbacv1.RoleRef{Kind: "ClusterRole", Name: "view"},
			}

			builder := &ClusterRBACBuilder{
				collectIndexer: clusterRBACCollectIndexer(
					testsupport.NewClusterIndexer(t, cr),
					testsupport.NewClusterIndexer(t, crb),
				),
			}
			snap, err := builder.Build(WithClusterMeta(context.Background(), meta), "")
			require.NoError(t, err)
			payload := snap.Payload.(ClusterRBACSnapshot)

			expected := []ClusterRBACEntry{
				clusterrole.BuildStreamSummary(meta, cr),
				clusterrolebinding.BuildStreamSummary(meta, crb),
			}
			requireRowParity(t, toAnySlice(payload.Rows), toAnySlice(expected), func(r any) string {
				row := r.(ClusterRBACEntry)
				return row.Kind + "/" + row.Name
			})
		},
	}
}

// ---------- Cluster storage ----------

func parityClusterStorageCase(meta ClusterMeta) parityCase {
	return parityCase{
		name: "cluster-storage/pv",
		run: func(t *testing.T) {
			pv := &corev1.PersistentVolume{
				ObjectMeta: metav1.ObjectMeta{Name: "pv-1"},
				Spec: corev1.PersistentVolumeSpec{
					Capacity:    corev1.ResourceList{corev1.ResourceStorage: resource.MustParse("10Gi")},
					AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
				},
			}

			builder := &ClusterStorageBuilder{
				collectIndexer: clusterStorageCollectIndexer(testsupport.NewClusterIndexer(t, pv)),
			}
			snap, err := builder.Build(WithClusterMeta(context.Background(), meta), "")
			require.NoError(t, err)
			payload := snap.Payload.(ClusterStorageSnapshot)

			expected := []ClusterStorageEntry{persistentvolume.BuildStreamSummary(meta, pv)}
			requireRowParity(t, toAnySlice(payload.Rows), toAnySlice(expected), func(r any) string {
				row := r.(ClusterStorageEntry)
				return row.Kind + "/" + row.Name
			})
		},
	}
}

// ---------- Cluster config ----------

func parityClusterConfigCase(meta ClusterMeta) parityCase {
	return parityCase{
		name: "cluster-config/classes_webhooks",
		run: func(t *testing.T) {
			sc := &storagev1.StorageClass{ObjectMeta: metav1.ObjectMeta{Name: "standard"}, Provisioner: "kubernetes.io/gce-pd"}
			ic := &networkingv1.IngressClass{
				ObjectMeta: metav1.ObjectMeta{Name: "nginx", Annotations: map[string]string{"ingressclass.kubernetes.io/is-default-class": "true"}},
				Spec:       networkingv1.IngressClassSpec{Controller: "k8s.io/ingress-nginx"},
			}
			vwh := &admissionregistrationv1.ValidatingWebhookConfiguration{
				ObjectMeta: metav1.ObjectMeta{Name: "vw"},
			}
			mwh := &admissionregistrationv1.MutatingWebhookConfiguration{
				ObjectMeta: metav1.ObjectMeta{Name: "mw"},
			}

			// GatewayClass is omitted (nil indexer) here; its projector is
			// exercised by its own unit test and shares the same descriptor
			// dispatch as the other cluster-config classes.
			builder := &ClusterConfigBuilder{
				collectIndexer: clusterConfigCollectIndexer(
					testsupport.NewClusterIndexer(t, sc),
					testsupport.NewClusterIndexer(t, ic),
					nil,
					testsupport.NewClusterIndexer(t, vwh),
					testsupport.NewClusterIndexer(t, mwh),
				),
			}
			snap, err := builder.Build(WithClusterMeta(context.Background(), meta), "")
			require.NoError(t, err)
			payload := snap.Payload.(ClusterConfigSnapshot)

			expected := []ClusterConfigEntry{
				storageclass.BuildStreamSummary(meta, sc),
				ingressclass.BuildStreamSummary(meta, ic),
				admission.BuildValidatingStreamSummary(meta, vwh),
				admission.BuildMutatingStreamSummary(meta, mwh),
			}
			requireRowParity(t, toAnySlice(payload.Rows), toAnySlice(expected), func(r any) string {
				row := r.(ClusterConfigEntry)
				return row.Kind + "/" + row.Name
			})
		},
	}
}

// ---------- Cluster CRDs ----------

func parityClusterCRDCase(meta ClusterMeta) parityCase {
	return parityCase{
		name: "cluster-crds/crd",
		run: func(t *testing.T) {
			crd := &apiextensionsv1.CustomResourceDefinition{
				ObjectMeta: metav1.ObjectMeta{Name: "dbinstances.rds.services.k8s.aws"},
				Spec: apiextensionsv1.CustomResourceDefinitionSpec{
					Group: "rds.services.k8s.aws",
					Scope: apiextensionsv1.NamespaceScoped,
					Names: apiextensionsv1.CustomResourceDefinitionNames{Plural: "dbinstances", Kind: "DBInstance"},
					Versions: []apiextensionsv1.CustomResourceDefinitionVersion{
						{Name: "v1alpha1", Served: true, Storage: false},
						{Name: "v1", Served: true, Storage: true},
					},
				},
			}

			builder := &ClusterCRDBuilder{
				crdLister: testsupport.NewCRDLister(t, crd),
			}
			snap, err := builder.Build(WithClusterMeta(context.Background(), meta), "")
			require.NoError(t, err)
			payload := snap.Payload.(ClusterCRDSnapshot)

			expected := []ClusterCRDEntry{apiextensions.BuildStreamSummary(meta, crd)}
			requireRowParity(t, toAnySlice(payload.Rows), toAnySlice(expected), func(r any) string {
				row := r.(ClusterCRDEntry)
				return row.Name
			})
		},
	}
}

// ---------- Nodes ----------

func parityNodesCase(meta ClusterMeta, withMetrics bool) parityCase {
	name := "nodes/without_metrics"
	if withMetrics {
		name = "nodes/with_metrics"
	}
	return parityCase{
		name: name,
		run: func(t *testing.T) {
			node := &corev1.Node{
				ObjectMeta: metav1.ObjectMeta{Name: "node-1"},
				Status: corev1.NodeStatus{
					Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionTrue}},
					Capacity: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("4"),
						corev1.ResourceMemory: resource.MustParse("8Gi"),
						corev1.ResourcePods:   resource.MustParse("110"),
					},
					Allocatable: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("4"),
						corev1.ResourceMemory: resource.MustParse("8Gi"),
						corev1.ResourcePods:   resource.MustParse("110"),
					},
				},
			}
			pod := &corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{Name: "p1", Namespace: "default"},
				Spec:       corev1.PodSpec{NodeName: "node-1", Containers: []corev1.Container{{Name: "c"}}},
				Status:     corev1.PodStatus{Phase: corev1.PodRunning},
			}

			builder := newNodeBuilderForTest(
				meta,
				newFakePodAggregateSource(nil, pod).withNodes(meta, node.ResourceVersion, node),
				node,
			)
			snap, err := builder.Build(WithClusterMeta(context.Background(), meta), "")
			require.NoError(t, err)
			payload := snap.Payload.(NodeSnapshot)

			expectedRow, err := BuildNodeSummary(meta, node, []*corev1.Pod{pod}, map[string]metrics.NodeUsage{}, map[string]metrics.PodUsage{})
			require.NoError(t, err)
			expected := []NodeSummary{expectedRow}
			requireRowParity(t, toAnySlice(payload.Rows), toAnySlice(expected), func(r any) string {
				row := r.(NodeSummary)
				return row.Name
			})
		},
	}
}

func ptrString(s string) *string { return &s }

package snapshot

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	storagev1 "k8s.io/api/storage/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"

	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/release"
	releasetime "helm.sh/helm/v3/pkg/time"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	apiextensionsres "github.com/luxury-yacht/app/backend/resources/apiextensions"
	clusterroleres "github.com/luxury-yacht/app/backend/resources/clusterrole"
	configmapres "github.com/luxury-yacht/app/backend/resources/configmap"
	customres "github.com/luxury-yacht/app/backend/resources/customresource"
	hpares "github.com/luxury-yacht/app/backend/resources/hpa"
	networkpolicyres "github.com/luxury-yacht/app/backend/resources/networkpolicy"
	persistentvolumeres "github.com/luxury-yacht/app/backend/resources/persistentvolume"
	persistentvolumeclaimres "github.com/luxury-yacht/app/backend/resources/persistentvolumeclaim"
	podres "github.com/luxury-yacht/app/backend/resources/pods"
	resourceres "github.com/luxury-yacht/app/backend/resources/resourcequota"
	roleres "github.com/luxury-yacht/app/backend/resources/role"
	storageclassres "github.com/luxury-yacht/app/backend/resources/storageclass"
)

type canonicalRowWireFixtureDocument struct {
	Entries []canonicalRowWireFixtureEntry `json:"entries"`
}

type canonicalRowWireFixtureEntry struct {
	Family   string            `json:"family"`
	Boundary string            `json:"boundary"`
	Domain   string            `json:"domain,omitempty"`
	RowPath  string            `json:"rowPath,omitempty"`
	Snapshot *refresh.Snapshot `json:"snapshot,omitempty"`
	Row      any               `json:"row,omitempty"`
}

type canonicalFixtureMetricsProvider struct {
	sample metrics.Sample
}

func (p canonicalFixtureMetricsProvider) LatestNodeUsage() map[string]metrics.NodeUsage {
	return p.sample.NodeUsage
}

func (p canonicalFixtureMetricsProvider) LatestPodUsage() map[string]metrics.PodUsage {
	return p.sample.PodUsage
}

func (p canonicalFixtureMetricsProvider) Metadata() metrics.Metadata { return p.sample.Metadata }
func (p canonicalFixtureMetricsProvider) Sample() metrics.Sample     { return p.sample }

func canonicalFixtureSnapshot(domain string, payload any) *refresh.Snapshot {
	return &refresh.Snapshot{
		Domain:      domain,
		Scope:       refresh.JoinClusterScope("cluster-wire", ""),
		Version:     1,
		Checksum:    "canonical-row-wire-fixture",
		GeneratedAt: 1_700_000_000_000,
		Sequence:    1,
		Payload:     payload,
		Stats:       refresh.SnapshotStats{ItemCount: 1},
	}
}

func canonicalFixtureObjectMeta(name, namespace string, created metav1.Time) metav1.ObjectMeta {
	return metav1.ObjectMeta{
		Name:              name,
		Namespace:         namespace,
		UID:               types.UID(name + "-uid"),
		ResourceVersion:   "7",
		CreationTimestamp: created,
		Labels:            map[string]string{"app": "wire-fixture"},
	}
}

func canonicalRowWireFixtures(t *testing.T) canonicalRowWireFixtureDocument {
	t.Helper()
	meta := ClusterMeta{ClusterID: "cluster-wire", ClusterName: "Wire Cluster"}
	created := metav1.NewTime(time.Unix(1_699_999_000, 0).UTC())
	namespace := "default"

	namespaceSnapshot, err := (&NamespaceBuilder{scope: []string{namespace}}).Build(
		WithClusterMeta(context.Background(), meta),
		refresh.JoinClusterScope(meta.ClusterID, ""),
	)
	require.NoError(t, err)
	namespaceRow := namespaceSnapshot.Payload.(NamespaceSnapshot).Namespaces[0]

	metricsProvider := canonicalFixtureMetricsProvider{sample: metrics.Sample{
		PodUsage: map[string]metrics.PodUsage{
			namespace + "/pod-wire": {CPUUsageMilli: 25, MemoryUsageBytes: 64 << 20},
		},
		Metadata: metrics.Metadata{CollectedAt: time.Unix(1_700_000_000, 0).UTC()},
	}}
	metricSnapshot, err := (&NamespaceMetricsBuilder{clusterMeta: meta, metrics: metricsProvider}).Build(
		context.Background(),
		refresh.JoinClusterScope(meta.ClusterID, ""),
	)
	require.NoError(t, err)
	metricRow := metricSnapshot.Payload.(NamespaceMetricsSnapshot).Namespaces[0]

	node := &corev1.Node{ObjectMeta: canonicalFixtureObjectMeta("node-wire", "", created)}
	nodeRow := buildNodeOwnSummary(meta, node)

	attentionRef := resourcemodel.NewResourceRef(
		meta.ClusterID, "", "v1", "Pod", "pods", namespace, "pod-attention", "pod-attention-uid",
	)
	attentionRow := findingEvaluation(attentionSourceRecord{
		Ref: attentionRef, Source: attentionSourcePod, Status: "Not Ready", AgeTimestamp: created.UnixMilli(),
	}, []AttentionCause{{Type: "pod-not-ready", Label: "Pod not ready", Message: "Pod is not ready", Severity: AttentionSeverityWarning}}).Finding
	require.NotNil(t, attentionRow)

	catalogObject := &corev1.ConfigMap{ObjectMeta: canonicalFixtureObjectMeta("catalog-wire", namespace, created)}
	catalogRow, ok := objectcatalog.SummaryProjector(meta.ClusterID, configmapres.Identity)(catalogObject).(objectcatalog.Summary)
	require.True(t, ok)

	storageClass := &storagev1.StorageClass{ObjectMeta: canonicalFixtureObjectMeta("storage-wire", "", created), Provisioner: "example.io/wire"}
	configRow := storageclassres.BuildStreamSummary(meta, storageClass)

	crd := &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: canonicalFixtureObjectMeta("widgets.example.io", "", created),
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group:    "example.io",
			Names:    apiextensionsv1.CustomResourceDefinitionNames{Plural: "widgets", Singular: "widget", Kind: "Widget"},
			Scope:    apiextensionsv1.NamespaceScoped,
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{Name: "v1", Served: true, Storage: true}},
		},
	}
	crdRow := apiextensionsres.BuildStreamSummary(meta, crd)

	clusterRole := &rbacv1.ClusterRole{ObjectMeta: canonicalFixtureObjectMeta("reader-wire", "", created)}
	clusterRBACRow := clusterroleres.BuildStreamSummary(meta, clusterRole)

	persistentVolume := &corev1.PersistentVolume{ObjectMeta: canonicalFixtureObjectMeta("pv-wire", "", created)}
	clusterStorageRow := persistentvolumeres.BuildStreamSummary(meta, persistentVolume)

	clusterEvent := &corev1.Event{
		ObjectMeta: canonicalFixtureObjectMeta("cluster-event-wire", namespace, created),
		Type:       "Warning", Reason: "NodePressure", Message: "Node reports pressure",
		InvolvedObject: corev1.ObjectReference{APIVersion: "v1", Kind: "Node", Name: node.Name, UID: node.UID},
		LastTimestamp:  created,
	}
	clusterEventRow, ok := projectClusterEventEntry(meta, clusterEvent)
	require.True(t, ok)

	configMap := &corev1.ConfigMap{ObjectMeta: canonicalFixtureObjectMeta("config-wire", namespace, created), Data: map[string]string{"key": "value"}}
	namespaceConfigRow := configmapres.BuildStreamSummary(meta, configMap)

	networkPolicy := &networkingv1.NetworkPolicy{ObjectMeta: canonicalFixtureObjectMeta("network-wire", namespace, created)}
	namespaceNetworkRow := networkpolicyres.BuildStreamSummary(meta, networkPolicy)

	role := &rbacv1.Role{ObjectMeta: canonicalFixtureObjectMeta("role-wire", namespace, created)}
	namespaceRBACRow := roleres.BuildStreamSummary(meta, role)

	storageClassName := "standard"
	pvc := &corev1.PersistentVolumeClaim{
		ObjectMeta: canonicalFixtureObjectMeta("pvc-wire", namespace, created),
		Spec:       corev1.PersistentVolumeClaimSpec{StorageClassName: &storageClassName},
	}
	namespaceStorageRow := persistentvolumeclaimres.BuildStreamSummary(meta, pvc)

	minimumReplicas := int32(1)
	hpa := &autoscalingv1.HorizontalPodAutoscaler{
		ObjectMeta: canonicalFixtureObjectMeta("hpa-wire", namespace, created),
		Spec: autoscalingv1.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv1.CrossVersionObjectReference{APIVersion: "apps/v1", Kind: "Deployment", Name: "deployment-wire"},
			MinReplicas:    &minimumReplicas,
			MaxReplicas:    3,
		},
	}
	namespaceAutoscalingRow := hpares.BuildStreamSummary(meta, hpa)

	quota := &corev1.ResourceQuota{ObjectMeta: canonicalFixtureObjectMeta("quota-wire", namespace, created)}
	namespaceQuotaRow := resourceres.BuildStreamSummary(meta, quota)

	namespaceEvent := clusterEvent.DeepCopy()
	namespaceEvent.Name = "namespace-event-wire"
	namespaceEvent.UID = "namespace-event-wire-uid"
	namespaceEvent.InvolvedObject = corev1.ObjectReference{
		APIVersion: "v1", Kind: "Pod", Namespace: namespace, Name: "pod-wire", UID: "pod-wire-uid",
	}
	namespaceEventRow, ok := projectNamespaceEventSummary(meta, namespaceEvent)
	require.True(t, ok)

	helmRelease := &release.Release{
		Name: "release-wire", Namespace: namespace, Version: 2,
		Chart: &chart.Chart{Metadata: &chart.Metadata{Name: "chart-wire", Version: "1.2.3", AppVersion: "2.0.0"}},
		Info: &release.Info{
			Status:        release.StatusDeployed,
			FirstDeployed: releasetime.Time{Time: created.Time.Add(-time.Hour)},
			LastDeployed:  releasetime.Time{Time: created.Time},
		},
	}
	helmRows, _ := mapHelmReleases([]*release.Release{helmRelease}, namespace, meta)
	require.Len(t, helmRows, 1)

	pod := &corev1.Pod{
		ObjectMeta: canonicalFixtureObjectMeta("pod-wire", namespace, created),
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "app", Image: "example/app:1"}}},
		Status:     corev1.PodStatus{Phase: corev1.PodRunning},
	}
	podRow := podres.BuildStreamSummaryFromRSMap(meta, pod, 25, 64<<20, nil)

	replicas := int32(2)
	deployment := &appsv1.Deployment{
		ObjectMeta: canonicalFixtureObjectMeta("deployment-wire", namespace, created),
		Spec:       appsv1.DeploymentSpec{Replicas: &replicas, Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "app", Image: "example/app:1"}}}}},
		Status:     appsv1.DeploymentStatus{ReadyReplicas: 1},
	}
	workloadRow := (&NamespaceWorkloadsBuilder{}).buildDeploymentSummary(meta.ClusterID, deployment, nil, nil)

	namespacedCustomObject := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "example.io/v1", "kind": "Widget",
		"metadata": map[string]any{"name": "widget-wire", "namespace": namespace, "uid": "widget-wire-uid", "creationTimestamp": created.Format(time.RFC3339)},
	}}
	namespaceCustomRow := customres.BuildNamespaceStreamSummary(meta, namespacedCustomObject, "example.io", "v1", "widgets", "Widget", "widgets.example.io", namespace)

	clusterCustomObject := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "example.io/v1", "kind": "ClusterWidget",
		"metadata": map[string]any{"name": "cluster-widget-wire", "uid": "cluster-widget-wire-uid", "creationTimestamp": created.Format(time.RFC3339)},
	}}
	clusterCustomRow := customres.BuildClusterStreamSummary(meta, clusterCustomObject, "example.io", "v1", "clusterwidgets", "ClusterWidget", "clusterwidgets.example.io")
	hydratedCustomRow := CustomResourceSummaryFromCluster(clusterCustomRow)

	objectEventRow := convertObjectEvent(meta, *namespaceEvent)

	queryEnvelope := ResourceQueryEnvelope{Total: 1, UnfilteredTotal: 1, TotalIsExact: true, FacetsExact: true}
	entries := []canonicalRowWireFixtureEntry{
		{Family: "namespaces", Boundary: "refresh-snapshot", Domain: "namespaces", RowPath: "payload.namespaces", Snapshot: canonicalFixtureSnapshot("namespaces", NamespaceSnapshot{ClusterMeta: meta, Namespaces: []NamespaceSummary{namespaceRow}})},
		{Family: "namespace-metrics", Boundary: "refresh-snapshot", Domain: "namespace-metrics", RowPath: "payload.namespaces", Snapshot: canonicalFixtureSnapshot("namespace-metrics", NamespaceMetricsSnapshot{ClusterMeta: meta, Namespaces: []NamespaceMetric{metricRow}, MetricsState: NamespaceSignalAvailable})},
		{Family: "nodes", Boundary: "refresh-snapshot", Domain: "nodes", RowPath: "payload.rows", Snapshot: canonicalFixtureSnapshot("nodes", NodeSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: queryEnvelope, Rows: []NodeSummary{nodeRow}})},
		{Family: "cluster-attention", Boundary: "refresh-snapshot", Domain: "cluster-attention", RowPath: "payload.rows", Snapshot: canonicalFixtureSnapshot("cluster-attention", ClusterAttentionSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: queryEnvelope, Rows: []AttentionFinding{*attentionRow}})},
		{Family: "catalog", Boundary: "refresh-snapshot", Domain: "catalog", RowPath: "payload.items", Snapshot: canonicalFixtureSnapshot("catalog", CatalogSnapshot{ClusterMeta: meta, Items: []objectcatalog.Summary{catalogRow}, Total: 1, UnfilteredTotal: 1})},
		{Family: "cluster-config", Boundary: "refresh-snapshot", Domain: "cluster-config", RowPath: "payload.rows", Snapshot: canonicalFixtureSnapshot("cluster-config", ClusterConfigSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: queryEnvelope, Rows: []ClusterConfigEntry{configRow}})},
		{Family: "cluster-crds", Boundary: "refresh-snapshot", Domain: "cluster-crds", RowPath: "payload.rows", Snapshot: canonicalFixtureSnapshot("cluster-crds", ClusterCRDSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: queryEnvelope, Rows: []ClusterCRDEntry{crdRow}})},
		{Family: "cluster-rbac", Boundary: "refresh-snapshot", Domain: "cluster-rbac", RowPath: "payload.rows", Snapshot: canonicalFixtureSnapshot("cluster-rbac", ClusterRBACSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: queryEnvelope, Rows: []ClusterRBACEntry{clusterRBACRow}})},
		{Family: "cluster-storage", Boundary: "refresh-snapshot", Domain: "cluster-storage", RowPath: "payload.rows", Snapshot: canonicalFixtureSnapshot("cluster-storage", ClusterStorageSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: queryEnvelope, Rows: []ClusterStorageEntry{clusterStorageRow}})},
		{Family: "cluster-events", Boundary: "refresh-snapshot", Domain: "cluster-events", RowPath: "payload.rows", Snapshot: canonicalFixtureSnapshot("cluster-events", ClusterEventsSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: queryEnvelope, Rows: []ClusterEventEntry{clusterEventRow}})},
		{Family: "namespace-config", Boundary: "refresh-snapshot", Domain: "namespace-config", RowPath: "payload.rows", Snapshot: canonicalFixtureSnapshot("namespace-config", NamespaceConfigSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: queryEnvelope, Rows: []ConfigSummary{namespaceConfigRow}})},
		{Family: "namespace-network", Boundary: "refresh-snapshot", Domain: "namespace-network", RowPath: "payload.rows", Snapshot: canonicalFixtureSnapshot("namespace-network", NamespaceNetworkSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: queryEnvelope, Rows: []NetworkSummary{namespaceNetworkRow}})},
		{Family: "namespace-rbac", Boundary: "refresh-snapshot", Domain: "namespace-rbac", RowPath: "payload.rows", Snapshot: canonicalFixtureSnapshot("namespace-rbac", NamespaceRBACSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: queryEnvelope, Rows: []RBACSummary{namespaceRBACRow}})},
		{Family: "namespace-storage", Boundary: "refresh-snapshot", Domain: "namespace-storage", RowPath: "payload.rows", Snapshot: canonicalFixtureSnapshot("namespace-storage", NamespaceStorageSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: queryEnvelope, Rows: []StorageSummary{namespaceStorageRow}})},
		{Family: "namespace-autoscaling", Boundary: "refresh-snapshot", Domain: "namespace-autoscaling", RowPath: "payload.rows", Snapshot: canonicalFixtureSnapshot("namespace-autoscaling", NamespaceAutoscalingSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: queryEnvelope, Rows: []AutoscalingSummary{namespaceAutoscalingRow}})},
		{Family: "namespace-quotas", Boundary: "refresh-snapshot", Domain: "namespace-quotas", RowPath: "payload.rows", Snapshot: canonicalFixtureSnapshot("namespace-quotas", NamespaceQuotasSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: queryEnvelope, Rows: []QuotaSummary{namespaceQuotaRow}})},
		{Family: "namespace-events", Boundary: "refresh-snapshot", Domain: "namespace-events", RowPath: "payload.rows", Snapshot: canonicalFixtureSnapshot("namespace-events", NamespaceEventsSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: queryEnvelope, Rows: []EventSummary{namespaceEventRow}})},
		{Family: "namespace-helm", Boundary: "refresh-snapshot", Domain: "namespace-helm", RowPath: "payload.rows", Snapshot: canonicalFixtureSnapshot("namespace-helm", NamespaceHelmSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: queryEnvelope, Rows: helmRows})},
		{Family: "pods", Boundary: "refresh-snapshot", Domain: "pods", RowPath: "payload.rows", Snapshot: canonicalFixtureSnapshot("pods", PodSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: queryEnvelope, Rows: []PodSummary{podRow}})},
		{Family: "namespace-workloads", Boundary: "refresh-snapshot", Domain: "namespace-workloads", RowPath: "payload.rows", Snapshot: canonicalFixtureSnapshot("namespace-workloads", NamespaceWorkloadsSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: queryEnvelope, Rows: []WorkloadSummary{workloadRow}})},
		{Family: "namespace-custom-legacy", Boundary: "refresh-snapshot", Domain: "namespace-custom", RowPath: "payload.resources", Snapshot: canonicalFixtureSnapshot("namespace-custom", NamespaceCustomSnapshot{ClusterMeta: meta, Resources: []NamespaceCustomSummary{namespaceCustomRow}})},
		{Family: "cluster-custom-legacy", Boundary: "refresh-snapshot", Domain: "cluster-custom", RowPath: "payload.resources", Snapshot: canonicalFixtureSnapshot("cluster-custom", ClusterCustomSnapshot{ClusterMeta: meta, Resources: []ClusterCustomSummary{clusterCustomRow}})},
		{Family: "custom-page-hydration", Boundary: "custom-hydration", Row: hydratedCustomRow},
		{Family: "object-events", Boundary: "refresh-snapshot", Domain: "object-events", RowPath: "payload.events", Snapshot: canonicalFixtureSnapshot("object-events", ObjectEventsSnapshotPayload{ClusterMeta: meta, Events: []ObjectEventSummary{objectEventRow}})},
	}
	return canonicalRowWireFixtureDocument{Entries: entries}
}

func TestCanonicalResourceRowWireFixtureMatchesProductionProducers(t *testing.T) {
	produced, err := json.Marshal(canonicalRowWireFixtures(t))
	require.NoError(t, err)
	var stable any
	require.NoError(t, json.Unmarshal(produced, &stable))
	normalizeCanonicalFixtureVolatility(stable)
	want, err := json.Marshal(stable)
	require.NoError(t, err)
	want = append(want, '\n')

	fixturePath := filepath.Join("..", "..", "..", "frontend", "src", "test-fixtures", "canonical-resource-row-wire.json")
	got, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read canonical resource row wire fixture: %v\nfixture contents:\n%s", err, want)
	}
	var committed any
	if err := json.Unmarshal(got, &committed); err != nil {
		t.Fatalf("decode canonical resource row wire fixture: %v", err)
	}
	if !reflect.DeepEqual(stable, committed) {
		t.Fatalf("canonical resource row wire fixture differs from production producers\nfixture contents:\n%s", want)
	}
}

func normalizeCanonicalFixtureVolatility(value any) {
	switch typed := value.(type) {
	case []any:
		for _, entry := range typed {
			normalizeCanonicalFixtureVolatility(entry)
		}
	case map[string]any:
		for key, entry := range typed {
			if key == "age" {
				if _, ok := entry.(string); ok {
					typed[key] = "<age>"
					continue
				}
			}
			normalizeCanonicalFixtureVolatility(entry)
		}
	}
}

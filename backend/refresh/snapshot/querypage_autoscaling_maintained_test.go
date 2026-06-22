package snapshot

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/resources/hpa"
)

func hpaObj(ns, name, rv, target string, maxReplicas int32) *autoscalingv1.HorizontalPodAutoscaler {
	min := int32(1)
	return &autoscalingv1.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name, ResourceVersion: rv},
		Spec: autoscalingv1.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv1.CrossVersionObjectReference{Kind: "Deployment", Name: target},
			MinReplicas:    &min,
			MaxReplicas:    maxReplicas,
		},
		Status: autoscalingv1.HorizontalPodAutoscalerStatus{CurrentReplicas: 2},
	}
}

func findAutoscalingRow(rows []AutoscalingSummary, kind, ns, name string) *AutoscalingSummary {
	for i := range rows {
		if rows[i].Kind == kind && rows[i].Namespace == ns && rows[i].Name == name {
			return &rows[i]
		}
	}
	return nil
}

func autoscalingDescriptor(t *testing.T, resource string) streamspec.Descriptor {
	t.Helper()
	for _, d := range kindregistry.StreamDescriptorsForDomain(namespaceAutoscalingDomainName) {
		if d.Resource == resource {
			return d
		}
	}
	t.Fatalf("no namespace-autoscaling descriptor for resource %q", resource)
	return streamspec.Descriptor{}
}

// TestAutoscalingMaintainedStoreIngestion proves the informer-fed store reflects
// Add/Update/Delete (incl. tombstone), tracks the max resourceVersion, and projects
// rows identically to a direct BuildStreamSummary.
func TestAutoscalingMaintainedStoreIngestion(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	hpaDesc := autoscalingDescriptor(t, "horizontalpodautoscalers")
	store := newTypedMaintainedStore(meta, autoscalingQuerypageSchema(), autoscalingTableQueryAdapter())
	available := map[string]bool{"HorizontalPodAutoscaler": true}

	store.ingest(hpaDesc, hpaObj("default", "h-a", "10", "api", 4))
	store.ingest(hpaDesc, hpaObj("default", "h-b", "12", "web", 6))
	store.ingest(hpaDesc, hpaObj("kube-system", "h-c", "8", "ctrl", 2))

	require.Equal(t, uint64(12), store.snapshotVersion(), "version tracks max resourceVersion")
	require.Len(t, store.rows("default", available), 2)
	require.Len(t, store.rows("", available), 3)
	require.Len(t, store.rows("kube-system", available), 1)

	want := hpa.BuildStreamSummary(meta, hpaObj("default", "h-a", "10", "api", 4))
	got := findAutoscalingRow(store.rows("default", available), "HorizontalPodAutoscaler", "default", "h-a")
	require.NotNil(t, got, "h-a present")
	require.Equal(t, want, *got, "projection matches BuildStreamSummary")

	// Update h-a in place: new resourceVersion + a different target, no duplicate.
	store.ingest(hpaDesc, hpaObj("default", "h-a", "20", "api-v2", 8))
	require.Equal(t, uint64(20), store.snapshotVersion())
	upd := findAutoscalingRow(store.rows("default", available), "HorizontalPodAutoscaler", "default", "h-a")
	require.NotNil(t, upd)
	require.Equal(t, "Deployment/api-v2", upd.Target)
	require.Len(t, store.rows("default", available), 2, "in-place update, no duplicate")

	// Delete h-b directly; delete h-c via a tombstone.
	store.evict(hpaDesc, hpaObj("default", "h-b", "21", "web", 6))
	store.evict(hpaDesc, cache.DeletedFinalStateUnknown{Key: "kube-system/h-c", Obj: hpaObj("kube-system", "h-c", "22", "ctrl", 2)})
	require.Nil(t, findAutoscalingRow(store.rows("default", available), "HorizontalPodAutoscaler", "default", "h-b"))
	require.Nil(t, findAutoscalingRow(store.rows("kube-system", available), "HorizontalPodAutoscaler", "kube-system", "h-c"))
	require.Len(t, store.rows("default", available), 1, "only h-a remains in default")
}

// TestAutoscalingMaintainedStoreMatchesListPath is the SAFETY GATE for the live
// cutover: fed the same objects, the maintained store's rows must equal exactly what
// the current list path produces, for every namespace scope.
func TestAutoscalingMaintainedStoreMatchesListPath(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	hpaDesc := autoscalingDescriptor(t, "horizontalpodautoscalers")

	hpas := []*autoscalingv1.HorizontalPodAutoscaler{
		hpaObj("default", "alpha", "1", "api", 4),
		hpaObj("default", "beta", "2", "web", 6),
		hpaObj("kube-system", "gamma", "3", "ctrl", 2),
		hpaObj("app", "delta", "4", "worker", 8),
	}

	hpaIdx := newNamespaceIndexer()
	store := newTypedMaintainedStore(meta, autoscalingQuerypageSchema(), autoscalingTableQueryAdapter())
	for _, h := range hpas {
		require.NoError(t, hpaIdx.Add(h))
		store.ingest(hpaDesc, h)
	}

	collect := autoscalingCollectIndexer(hpaIdx)
	available := map[string]bool{"HorizontalPodAutoscaler": true}
	for _, ns := range []string{"default", "kube-system", "app", ""} {
		listed, _, _, err := collectDescriptorTableRows[AutoscalingSummary](
			context.Background(), namespaceAutoscalingDomainName, collect, meta, ns,
		)
		require.NoError(t, err)
		require.ElementsMatch(t, listed, store.rows(ns, available),
			"maintained store rows must equal the list path for namespace %q", ns)
	}
}

// TestNamespaceAutoscalingBuilderMaintainedMatchesListPath is the end-to-end cutover
// proof: fed the same objects, a builder serving from the maintained store produces
// a byte-identical snapshot payload to the list-path builder, across window, query,
// filter, and search scopes.
func TestNamespaceAutoscalingBuilderMaintainedMatchesListPath(t *testing.T) {
	hpaDesc := autoscalingDescriptor(t, "horizontalpodautoscalers")

	hpas := []*autoscalingv1.HorizontalPodAutoscaler{
		hpaObj("default", "alpha", "1", "api", 4),
		hpaObj("default", "beta", "2", "web", 6),
		hpaObj("kube-system", "gamma", "3", "ctrl", 2),
	}

	hpaIdx := newNamespaceIndexer()
	maintained := newTypedMaintainedStore(ClusterMeta{}, autoscalingQuerypageSchema(), autoscalingTableQueryAdapter())
	for _, h := range hpas {
		require.NoError(t, hpaIdx.Add(h))
		maintained.ingest(hpaDesc, h)
	}

	collect := autoscalingCollectIndexer(hpaIdx)
	listBuilder := &NamespaceAutoscalingBuilder{collectIndexer: collect}
	maintainedBuilder := &NamespaceAutoscalingBuilder{collectIndexer: collect, maintained: maintained}

	scopes := []string{
		"namespace:default",
		"namespace:all",
		"cluster-a|namespace:all?limit=2&sortField=name&sortDirection=asc",
		"cluster-a|namespace:all?limit=50&sortField=max&sortDirection=desc",
		"cluster-a|namespace:all?search=alpha",
	}
	for _, scope := range scopes {
		listSnap, err := listBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "list build %q", scope)
		maintSnap, err := maintainedBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "maintained build %q", scope)

		require.Equal(t,
			listSnap.Payload.(NamespaceAutoscalingSnapshot),
			maintSnap.Payload.(NamespaceAutoscalingSnapshot),
			"scope %q: maintained Build payload must equal the list Build payload", scope)
	}
}

package snapshot

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes/fake"
)

// objectMapCatalogRow is a catalog Summary for the object-map catalog tests.
func objectMapCatalogRow(group, version, kind, resource, namespace, name, uid, created string) objectcatalog.Summary {
	scope := objectcatalog.ScopeNamespace
	if namespace == "" {
		scope = objectcatalog.ScopeCluster
	}
	return objectcatalog.Summary{
		Ref: resourcemodel.ResourceRef{
			ClusterID: "cluster-a", Group: group, Version: version, Kind: kind, Resource: resource,
			Namespace: namespace, Name: name, UID: uid,
		},
		Scope:             scope,
		CreationTimestamp: created,
	}
}

func withObjectMapCatalog(t *testing.T, builder *objectMapBuilder, rows ...objectcatalog.Summary) {
	t.Helper()
	catalog := seedCatalogService(t, rows)
	builder.catalogService = func() *objectcatalog.Service { return catalog }
}

// An object the map knows only from the catalog (a custom resource owning a
// ReplicaSet) is still drawn, with the catalog's identity and timestamp.
func TestObjectMapCatalogOnlyOwnerKeepsOwnerEdge(t *testing.T) {
	rs := replicaSetFixture("default", "web-rs", "rs-uid", "web", "rollout-uid")
	rs.OwnerReferences[0].APIVersion = "argoproj.io/v1alpha1"
	rs.OwnerReferences[0].Kind = "Rollout"
	builder := newObjectMapTestBuilder(t, fake.NewSimpleClientset(rs))
	withObjectMapCatalog(t, builder,
		objectMapCatalogRow("argoproj.io", "v1alpha1", "Rollout", "rollouts", "default", "web", "rollout-uid", "2026-01-02T03:04:05Z"),
	)
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"})

	snap, err := builder.Build(ctx, "default:apps/v1:ReplicaSet:web-rs")
	require.NoError(t, err)
	payload := snap.Payload.(ObjectMapSnapshotPayload)

	assertEdge(t, payload, "Rollout", "web", "ReplicaSet", "web-rs", "owner")
	rollout := nodeByKindName(t, payload, "Rollout", "web")
	require.Equal(t, "rollouts", rollout.Ref.Resource)
	require.Equal(t, "rollout-uid", rollout.Ref.UID)
	require.Equal(t, "2026-01-02T03:04:05Z", rollout.CreationTimestamp)
}

// A reference target present only in the catalog (a ConfigMap a Pod's volume
// names) keeps the Pod's link to it.
func TestObjectMapCatalogOnlyCoreRefTargetKeepsEdge(t *testing.T) {
	pod := podFixture("default", "web-pod", "pod-uid", "", map[string]string{"app": "web"})
	builder := newObjectMapTestBuilder(t, fake.NewSimpleClientset(pod))
	withObjectMapCatalog(t, builder,
		objectMapCatalogRow("", "v1", "ConfigMap", "configmaps", "default", "app-config", "config-uid", ""),
	)
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"})

	snap, err := builder.Build(ctx, "default:/v1:Pod:web-pod")
	require.NoError(t, err)

	assertEdge(t, snap.Payload.(ObjectMapSnapshotPayload), "Pod", "web-pod", "ConfigMap", "app-config", "uses")
}

// When the map collects an object itself, that record is the only source of
// its fields; a catalog row for the same object never overrides them.
func TestObjectMapCollectedRecordFieldsWinOverCatalog(t *testing.T) {
	svc := serviceFixture("default", "web", "svc-uid", map[string]string{"app": "web"})
	svc.CreationTimestamp = metav1.NewTime(time.Date(2026, 5, 6, 7, 8, 9, 0, time.UTC))
	builder := newObjectMapTestBuilder(t, fake.NewSimpleClientset(svc))
	withObjectMapCatalog(t, builder,
		objectMapCatalogRow("", "v1", "Service", "stale-services", "default", "web", "svc-uid", "2020-01-01T00:00:00Z"),
	)
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"})

	snap, err := builder.Build(ctx, "default:/v1:Service:web")
	require.NoError(t, err)

	node := nodeByKindName(t, snap.Payload.(ObjectMapSnapshotPayload), "Service", "web")
	require.Equal(t, "services", node.Ref.Resource)
	require.Equal(t, "2026-05-06T07:08:09Z", node.CreationTimestamp)
}

// A UID names one object whatever its served version. The catalog may record
// an HPA as autoscaling/v1 while the map collects it as v2; both identities
// resolve to the one collected v2 node.
func TestObjectMapServedVersionsResolveToOneNode(t *testing.T) {
	hpa := &autoscalingv2.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default", UID: types.UID("hpa-uid")},
		Spec: autoscalingv2.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv2.CrossVersionObjectReference{APIVersion: "apps/v1", Kind: "Deployment", Name: "web"},
		},
	}
	builder := newObjectMapTestBuilder(t, fake.NewSimpleClientset(hpa, &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "default"}}))
	withObjectMapCatalog(t, builder,
		objectMapCatalogRow("autoscaling", "v1", "HorizontalPodAutoscaler", "horizontalpodautoscalers", "default", "web", "hpa-uid", ""),
	)
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"})

	var seedIDs []string
	for _, scope := range []string{
		"default:autoscaling/v2:HorizontalPodAutoscaler:web",
		"default:autoscaling/v1:HorizontalPodAutoscaler:web",
	} {
		snap, err := builder.Build(ctx, scope)
		require.NoError(t, err, scope)
		payload := snap.Payload.(ObjectMapSnapshotPayload)
		require.Len(t, payload.Nodes, 1, scope)
		require.Equal(t, "v2", payload.Nodes[0].Ref.Version, scope)
		require.Equal(t, "v2", payload.Seed.Version, scope)
		seedIDs = append(seedIDs, payload.Nodes[0].ID)
	}
	require.Equal(t, seedIDs[0], seedIDs[1])
}

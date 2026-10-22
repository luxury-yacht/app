package snapshot

import (
	"context"
	"testing"

	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes/fake"
)

func TestObjectMapHPAEnrichmentDoesNotMutateRetainedIngestFacts(t *testing.T) {
	deployment := &appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default", UID: "deployment-uid"}}
	hpa := &autoscalingv2.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{Name: "web-scaler", Namespace: "default"},
		Spec:       autoscalingv2.HorizontalPodAutoscalerSpec{ScaleTargetRef: autoscalingv2.CrossVersionObjectReference{APIVersion: "apps/v1", Kind: "Deployment", Name: "web"}},
	}
	builder := newObjectMapTestBuilder(t, fake.NewSimpleClientset(deployment, hpa))
	// The graph may see an intake row before the independently published catalog.
	builder.catalogService = nil
	stored := builder.ingest.(*fakeObjectMapIngestSource).rows[DeploymentGVR][0].(objectmapnode.Node)
	require.NotNil(t, stored.ActionFacts)
	require.Nil(t, stored.ActionFacts.HPAManaged)
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"})
	snapshot, err := builder.Build(ctx, "default:apps/v1:Deployment:web")
	require.NoError(t, err)
	row := nodeByKindName(t, snapshot.Payload.(ObjectMapSnapshotPayload), "Deployment", "web")
	require.NotNil(t, row.ActionFacts.HPAManaged)
	require.True(t, *row.ActionFacts.HPAManaged)
	require.Nil(t, stored.ActionFacts.HPAManaged, "a graph-specific join must not publish back into the shared intake row")
	// Losing HPA visibility must restore unknown, without inheriting an earlier build.
	builder.permissions = denyPermissions{denied: map[string]bool{"horizontalpodautoscalers": true}}
	next, err := builder.Build(ctx, "default:apps/v1:Deployment:web")
	require.NoError(t, err)
	nextRow := nodeByKindName(t, next.Payload.(ObjectMapSnapshotPayload), "Deployment", "web")
	require.Nil(t, nextRow.ActionFacts.HPAManaged)
	require.True(t, *row.ActionFacts.HPAManaged, "later builds must leave earlier payloads unchanged")
}

// The object map offers ordinary scaling only when it knows no HPA targets the
// workload, so an HPA store that settled without data (deadline degrade)
// leaves the workload's ownership unknown.
func TestObjectMapHPAOwnershipUnknownWhileHPADataIncomplete(t *testing.T) {
	deployment := &appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default", UID: "deployment-uid"}}
	builder := newObjectMapTestBuilder(t, fake.NewSimpleClientset(deployment))
	builder.catalogService = nil
	builder.ingest.(*fakeObjectMapIngestSource).readiness = map[schema.GroupVersionResource][]ingest.PartitionReadiness{
		HPAGVR: {{State: refresh.ResourceReadinessDegraded}},
	}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"})
	snapshot, err := builder.Build(ctx, "default:apps/v1:Deployment:web")
	require.NoError(t, err)
	require.Nil(t, nodeByKindName(t, snapshot.Payload.(ObjectMapSnapshotPayload), "Deployment", "web").ActionFacts.HPAManaged)

	builder.ingest.(*fakeObjectMapIngestSource).readiness = nil
	snapshot, err = builder.Build(ctx, "default:apps/v1:Deployment:web")
	require.NoError(t, err)
	managed := nodeByKindName(t, snapshot.Payload.(ObjectMapSnapshotPayload), "Deployment", "web").ActionFacts.HPAManaged
	require.NotNil(t, managed)
	require.False(t, *managed)
}

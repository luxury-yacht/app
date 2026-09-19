package snapshot

import (
	"context"
	"testing"

	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
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

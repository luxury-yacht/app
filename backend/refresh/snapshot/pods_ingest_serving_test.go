package snapshot

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func TestPodBuilderReusesIngestedRowsAcrossBuildsAndPublishesUpdates(t *testing.T) {
	meta := ClusterMeta{ClusterID: "cluster-a"}
	project := NewPodIngestProjector(meta, PodOwnerSources{})
	projections := 0
	source := ingest.NewProjectingStore(func(obj interface{}) (interface{}, error) {
		projections++
		return project(obj)
	})
	source.SetRetainTable(true)
	maintained := newTypedMaintainedStore(meta, podQuerypageSchema(), podTableQueryAdapter())
	source.AddSink(maintained.Sink())
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "api", ResourceVersion: "17"},
		Spec:       corev1.PodSpec{NodeName: "node-1"},
	}
	require.NoError(t, source.Add(pod))
	builder := &PodBuilder{maintained: maintained, perBuild: &perBuildStoreCache[PodSummary]{}}
	ctx := WithClusterMeta(context.Background(), meta)
	scope := "cluster-a|namespace:team-a?limit=10"
	first, err := builder.Build(ctx, scope)
	require.NoError(t, err)
	second, err := builder.Build(ctx, scope)
	require.NoError(t, err)
	require.Equal(t, 1, projections, "refetches must reuse the intake projection")
	require.Equal(t, first.Payload, second.Payload)
	require.Equal(t, first.Version, second.Version)
	require.Equal(t, "node-1", first.Payload.(PodSnapshot).Rows[0].Node)

	updated := pod.DeepCopy()
	updated.ResourceVersion = "18"
	updated.Spec.NodeName = "node-2"
	require.NoError(t, source.Update(updated))
	third, err := builder.Build(ctx, scope)
	require.NoError(t, err)
	require.Equal(t, 2, projections)
	require.Greater(t, third.Version, second.Version, "intake updates must invalidate the query cache")
	require.Equal(t, "node-2", third.Payload.(PodSnapshot).Rows[0].Node)

	require.NoError(t, source.Delete(updated))
	final, err := builder.Build(ctx, scope)
	require.NoError(t, err)
	require.Empty(t, final.Payload.(PodSnapshot).Rows)
	require.Greater(t, final.Version, third.Version)
}

func TestPodBuilderRejectsInvalidScopesWithoutBlockingValidObjects(t *testing.T) {
	meta := ClusterMeta{ClusterID: "cluster-a"}
	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "api"}}
	builder := newTestPodBuilder(t, meta, testsupport.NewPodLister(t, pod), nil, nil)
	ctx := WithClusterMeta(context.Background(), meta)
	for _, scope := range []string{
		"", "broken", "namespace:", "unsupported:value",
		"workload:team-a::v1:Deployment:api",
		"object:team-a:other:v1:Pod:api",
		"object:team-a::v2:Pod:api",
	} {
		_, err := builder.Build(ctx, scope)
		require.Error(t, err, scope)
	}
	snapshot, err := builder.Build(ctx, "cluster-a|object:team-a::v1:Pod:api")
	require.NoError(t, err)
	rows := snapshot.Payload.(PodSnapshot).Rows
	require.Len(t, rows, 1)
	require.Equal(t, meta.ClusterID, rows[0].Ref.ClusterID)
	require.Equal(t, "api", rows[0].Ref.Name)
}

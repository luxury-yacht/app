package snapshot

import (
	"testing"

	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/labels"
	appslisters "k8s.io/client-go/listers/apps/v1"
	corelisters "k8s.io/client-go/listers/core/v1"

	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
)

// Typed fixtures enter through the production projector and sink before serving.
// The snapshot builder never reads these fixture listers.
func newTestPodBuilder(t testing.TB, meta ClusterMeta, pods corelisters.PodLister, replicaSets appslisters.ReplicaSetLister, provider metrics.Provider) *PodBuilder {
	t.Helper()
	objects, err := pods.List(labels.Everything())
	require.NoError(t, err)
	maintained := newTypedMaintainedStore(meta, podQuerypageSchema(), podTableQueryAdapter())
	source := ingest.NewProjectingStore(NewPodIngestProjector(meta, PodOwnerSources{ReplicaSets: replicaSets}))
	source.SetRetainTable(true)
	source.AddSink(maintained.Sink())
	for _, pod := range objects {
		require.NoError(t, source.Add(pod))
	}
	return &PodBuilder{
		maintained: maintained,
		metrics:    provider,
		perBuild:   &perBuildStoreCache[PodSummary]{},
	}
}

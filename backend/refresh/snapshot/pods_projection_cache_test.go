package snapshot

import (
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
)

// A metrics poll must not re-project a pod's object row. The expensive build
// (status model, facts, owner resolution, resource totals) runs once per
// (UID, resourceVersion); only CPU/mem are overlaid from the current sample, so
// the row stays fresh without rebuilding. This is the pod half of the metrics
// column-family split: object identity and metrics advance on different cadences,
// so they must not share a projection-cache key.
func TestPodProjectionReusesObjectRowAcrossMetricsRevisions(t *testing.T) {
	var buildCount int
	b := &PodBuilder{
		projCache: newPodProjectionCache(),
		buildSummary: func(_ ClusterMeta, pod *corev1.Pod, cpuMilli, memBytes int64, _ map[string]string) PodSummary {
			buildCount++
			return PodSummary{
				Name:     pod.Name,
				CPUUsage: streamrows.FormatCPUMilli(cpuMilli),
				MemUsage: streamrows.FormatMemoryBytes(memBytes),
			}
		},
	}

	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{
		UID:             types.UID("pod-uid"),
		ResourceVersion: "100",
		Name:            "p",
		Namespace:       "ns",
	}}

	usage1 := map[string]metrics.PodUsage{"ns/p": {CPUUsageMilli: 100, MemoryUsageBytes: 1 << 20}}
	usage2 := map[string]metrics.PodUsage{"ns/p": {CPUUsageMilli: 250, MemoryUsageBytes: 4 << 20}}

	// Same pod (UID + resourceVersion unchanged); only the metrics sample differs.
	s1 := b.projectPod(ClusterMeta{}, pod, usage1, nil)
	s2 := b.projectPod(ClusterMeta{}, pod, usage2, nil)

	require.Equal(t, 1, buildCount,
		"object row should be projected once per (UID, resourceVersion), not re-projected on each metrics poll")
	require.Equal(t, streamrows.FormatCPUMilli(100), s1.CPUUsage,
		"first row reflects the first metrics sample")
	require.Equal(t, streamrows.FormatCPUMilli(250), s2.CPUUsage,
		"metrics overlay keeps CPU current across a metrics poll despite the reused object row")
	require.Equal(t, streamrows.FormatMemoryBytes(4<<20), s2.MemUsage,
		"metrics overlay keeps memory current across a metrics poll despite the reused object row")
}

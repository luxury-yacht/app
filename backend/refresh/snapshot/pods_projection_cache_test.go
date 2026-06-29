package snapshot

import (
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
)

func TestPodProjectionReusesObjectRowForSameResourceVersion(t *testing.T) {
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

	s1 := b.projectPod(ClusterMeta{}, pod, nil)
	s2 := b.projectPod(ClusterMeta{}, pod, nil)

	require.Equal(t, 1, buildCount,
		"object row should be projected once per (UID, resourceVersion)")
	require.Equal(t, s1, s2)
	require.Equal(t, streamrows.MetricsNoData, s1.CPUUsage)
	require.Equal(t, streamrows.MetricsNoData, s1.MemUsage)
}

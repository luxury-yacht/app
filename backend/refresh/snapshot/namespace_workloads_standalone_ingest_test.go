package snapshot

import (
	"testing"

	"github.com/luxury-yacht/app/backend/refresh/metrics"
	podres "github.com/luxury-yacht/app/backend/resources/pods"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// TestBuildStandalonePodSummaryFromRowsMatchesTyped proves the ingest-fed standalone
// WorkloadSummary (built from the pod's projected PodSummary + PodAggregate rows) is
// byte-identical to the typed buildStandalonePodSummary, for every field, across pods
// with and without resource reservations, restarts, and metrics usage.
func TestBuildStandalonePodSummaryFromRowsMatchesTyped(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c-1", ClusterName: "prod"}
	streamMeta := meta // ClusterMeta is a type alias of streamrows.ClusterMeta

	cases := []struct {
		name  string
		pod   *corev1.Pod
		usage map[string]metrics.PodUsage
	}{
		{
			name: "running pod with resources, restarts and usage",
			pod: &corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{Namespace: "prod", Name: "lonely-1", CreationTimestamp: metav1.Now()},
				Spec: corev1.PodSpec{
					NodeName: "node-1",
					Containers: []corev1.Container{
						{
							Name:  "app",
							Ports: []corev1.ContainerPort{{ContainerPort: 8080}},
							Resources: corev1.ResourceRequirements{
								Requests: corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("250m"), corev1.ResourceMemory: resource.MustParse("256Mi")},
								Limits:   corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("500m"), corev1.ResourceMemory: resource.MustParse("512Mi")},
							},
						},
					},
				},
				Status: corev1.PodStatus{
					Phase:             corev1.PodRunning,
					ContainerStatuses: []corev1.ContainerStatus{{Name: "app", Ready: true, RestartCount: 3}},
				},
			},
			usage: map[string]metrics.PodUsage{"prod/lonely-1": {CPUUsageMilli: 123, MemoryUsageBytes: 200 * 1024 * 1024}},
		},
		{
			name: "pending pod no resources no usage",
			pod: &corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{Namespace: "prod", Name: "lonely-2"},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "c"}}},
				Status:     corev1.PodStatus{Phase: corev1.PodPending},
			},
			usage: nil,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			want := buildStandalonePodSummary(meta.ClusterID, tc.pod, tc.usage)

			// The ingest rows the pod reflector projects for this pod.
			podSummary := podres.BuildStreamSummary(streamMeta, tc.pod, 0, 0, nil)
			agg := projectPodAggregate(tc.pod, nil)
			got := buildStandalonePodSummaryFromRows(podSummary, agg, tc.usage)

			if got != want {
				t.Fatalf("standalone WorkloadSummary mismatch:\n got=%#v\nwant=%#v", got, want)
			}
		})
	}
}

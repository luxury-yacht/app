package snapshot

import (
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	podres "github.com/luxury-yacht/app/backend/resources/pods"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/utils/ptr"
)

// TestBuildStandalonePodSummaryFromRows pins the ingest-fed standalone
// WorkloadSummary (built from the pod's projected PodSummary + PodAggregate
// rows) for pods with and without resource reservations, restarts, and metrics
// usage. The expected rows are golden values captured from the typed
// buildStandalonePodSummary before that superseded builder was deleted, so the
// projection contract survives the deletion. Age/AgeTimestamp derive from the
// pod's CreationTimestamp and are asserted structurally.
func TestBuildStandalonePodSummaryFromRows(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c-1", ClusterName: "prod"}
	streamMeta := meta // ClusterMeta is a type alias of streamrows.ClusterMeta

	cases := []struct {
		name         string
		pod          *corev1.Pod
		usage        map[string]metrics.PodUsage
		want         WorkloadSummary
		wantFreshAge bool
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
			want: WorkloadSummary{Ref: resourcemodel.ResourceRef{Kind: "Pod", Namespace: "prod", Name: "lonely-1"}, Ready: "1/1", Status: "Running", StatusState: "Running", StatusPresentation: "ready",
				Restarts:      3,
				CPUUsageMilli: ptr.To[int64](123), CPURequestMilli: 250, CPULimitMilli: 500,
				MemoryUsageBytes: ptr.To[int64](200 << 20), MemoryRequestBytes: 256 << 20, MemoryLimitBytes: 512 << 20,
				PortForwardAvailable: true,
			},
			wantFreshAge: true,
		},
		{
			name: "pending pod no resources no usage",
			pod: &corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{Namespace: "prod", Name: "lonely-2"},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "c"}}},
				Status:     corev1.PodStatus{Phase: corev1.PodPending},
			},
			usage: nil,
			want:  WorkloadSummary{Ref: resourcemodel.ResourceRef{Kind: "Pod", Namespace: "prod", Name: "lonely-2"}, Ready: "0/1", Status: "Pending", StatusState: "Pending", StatusPresentation: "warning"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// The ingest rows the pod reflector projects for this pod.
			podSummary := podres.BuildStreamSummary(streamMeta, tc.pod, nil, nil)
			agg := projectPodAggregate(tc.pod, PodOwnerSources{})
			got := buildStandalonePodSummaryFromRows(podSummary, agg, tc.usage)

			if tc.wantFreshAge {
				if got.AgeTimestamp <= 0 {
					t.Fatalf("expected fresh AgeTimestamp, got %d", got.AgeTimestamp)
				}
			} else if got.AgeTimestamp != 0 {
				t.Fatalf("expected zero AgeTimestamp, got %d", got.AgeTimestamp)
			}

			// Age/AgeTimestamp derive from CreationTimestamp (asserted above);
			// normalize them so the remaining fields compare exactly.
			tc.want.Age = got.Age
			tc.want.AgeTimestamp = got.AgeTimestamp
			tc.want.Ref = podSummary.Ref
			require.Equal(t, tc.want, got, "standalone WorkloadSummary mismatch")
		})
	}
}

// A standalone pod's own sample decides its usage: a sample of zero stays zero, and a
// sample predating the pod (a recreated same-name pod) reads as no data, as in the
// Pods table.
func TestBuildStandalonePodSummaryFromRowsDistinguishesZeroFromMissingUsage(t *testing.T) {
	created := time.Now().Add(-time.Hour).Truncate(time.Second)
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "prod", Name: "idle", CreationTimestamp: metav1.NewTime(created)},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "c"}}},
		Status:     corev1.PodStatus{Phase: corev1.PodRunning},
	}
	podSummary := podres.BuildStreamSummary(ClusterMeta{}, pod, nil, nil)
	agg := projectPodAggregate(pod, PodOwnerSources{})

	zero := buildStandalonePodSummaryFromRows(podSummary, agg, map[string]metrics.PodUsage{
		"prod/idle": {Timestamp: created.Add(time.Minute)},
	})
	require.Equal(t, ptr.To[int64](0), zero.CPUUsageMilli)
	require.Equal(t, ptr.To[int64](0), zero.MemoryUsageBytes)

	stale := buildStandalonePodSummaryFromRows(podSummary, agg, map[string]metrics.PodUsage{
		"prod/idle": {CPUUsageMilli: 900, MemoryUsageBytes: 4 << 30, Timestamp: created.Add(-time.Minute)},
	})
	require.Nil(t, stale.CPUUsageMilli)
	require.Nil(t, stale.MemoryUsageBytes)
}

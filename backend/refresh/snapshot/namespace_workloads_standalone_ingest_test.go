package snapshot

import (
	"testing"

	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	podres "github.com/luxury-yacht/app/backend/resources/pods"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
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
				Restarts: 3,
				CPUUsage: "123m", CPURequest: "250m", CPULimit: "500m",
				MemUsage: "200Mi", MemRequest: "256Mi", MemLimit: "512Mi",
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
			want: WorkloadSummary{Ref: resourcemodel.ResourceRef{Kind: "Pod", Namespace: "prod", Name: "lonely-2"}, Ready: "0/1", Status: "Pending", StatusState: "Pending", StatusPresentation: "warning",
				CPUUsage: "-", CPURequest: "-", CPULimit: "-",
				MemUsage: "-", MemRequest: "-", MemLimit: "-",
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// The ingest rows the pod reflector projects for this pod.
			podSummary := podres.BuildStreamSummary(streamMeta, tc.pod, 0, 0, nil, nil)
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
			if got != tc.want {
				t.Fatalf("standalone WorkloadSummary mismatch:\n got=%#v\nwant=%#v", got, tc.want)
			}
		})
	}
}

package snapshot

import (
	"testing"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	podres "github.com/luxury-yacht/app/backend/resources/pods"
	"github.com/luxury-yacht/app/backend/testsupport"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	appslisters "k8s.io/client-go/listers/apps/v1"
)

// containerResources is a small helper for building a container with the four
// resource quantities the aggregation reads.
func containerResources(cpuReq, memReq, cpuLim, memLim string) corev1.ResourceRequirements {
	req := corev1.ResourceList{}
	lim := corev1.ResourceList{}
	if cpuReq != "" {
		req[corev1.ResourceCPU] = resource.MustParse(cpuReq)
	}
	if memReq != "" {
		req[corev1.ResourceMemory] = resource.MustParse(memReq)
	}
	if cpuLim != "" {
		lim[corev1.ResourceCPU] = resource.MustParse(cpuLim)
	}
	if memLim != "" {
		lim[corev1.ResourceMemory] = resource.MustParse(memLim)
	}
	return corev1.ResourceRequirements{Requests: req, Limits: lim}
}

// TestProjectPodAggregateMatchesCurrentComputations asserts the projected
// aggregation row equals exactly what the three domains compute inline today.
// It recomputes each aggregate from the typed pod using the SAME math the
// production code uses (the oracle) and compares field-by-field.
func TestProjectPodAggregateMatchesCurrentComputations(t *testing.T) {
	cases := []struct {
		name string
		pod  *corev1.Pod
	}{
		{
			name: "rs-owned running pod with init container and restarts",
			pod: &corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Namespace: "team-a",
					Name:      "web-7d9c8b6f5-abcde",
					OwnerReferences: []metav1.OwnerReference{
						{Kind: "ReplicaSet", Name: "web-7d9c8b6f5", Controller: ptrBool(true)},
					},
				},
				Spec: corev1.PodSpec{
					NodeName: "node-1",
					Containers: []corev1.Container{
						{Name: "app", Resources: containerResources("250m", "256Mi", "500m", "512Mi")},
						{Name: "sidecar", Resources: containerResources("100m", "64Mi", "", "")},
					},
					InitContainers: []corev1.Container{
						{Name: "init", Resources: containerResources("50m", "32Mi", "75m", "48Mi")},
					},
				},
				Status: corev1.PodStatus{
					Phase: corev1.PodRunning,
					ContainerStatuses: []corev1.ContainerStatus{
						{Name: "app", Ready: true, RestartCount: 2},
						{Name: "sidecar", Ready: false, RestartCount: 1},
					},
					InitContainerStatuses: []corev1.ContainerStatus{
						{Name: "init", RestartCount: 3},
					},
					EphemeralContainerStatuses: []corev1.ContainerStatus{
						{Name: "debug", RestartCount: 5},
					},
				},
			},
		},
		{
			name: "standalone succeeded pod",
			pod: &corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{Namespace: "batch", Name: "one-shot"},
				Spec: corev1.PodSpec{
					NodeName: "node-2",
					Containers: []corev1.Container{
						{Name: "job", Resources: containerResources("1000m", "1Gi", "2000m", "2Gi")},
					},
				},
				Status: corev1.PodStatus{
					Phase: corev1.PodSucceeded,
					ContainerStatuses: []corev1.ContainerStatus{
						{Name: "job", Ready: false, RestartCount: 0},
					},
				},
			},
		},
		{
			name: "pending pod no node no resources",
			pod: &corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{Namespace: "team-b", Name: "pending-x"},
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{{Name: "c"}},
				},
				Status: corev1.PodStatus{Phase: corev1.PodPending},
			},
		},
		{
			name: "daemonset-owned failed pod",
			pod: &corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Namespace: "kube-system",
					Name:      "agent-zzz",
					OwnerReferences: []metav1.OwnerReference{
						{Kind: "DaemonSet", Name: "agent", Controller: ptrBool(true)},
					},
				},
				Spec: corev1.PodSpec{
					NodeName: "node-3",
					Containers: []corev1.Container{
						{Name: "agent", Resources: containerResources("10m", "16Mi", "20m", "32Mi")},
					},
				},
				Status: corev1.PodStatus{
					Phase: corev1.PodFailed,
					ContainerStatuses: []corev1.ContainerStatus{
						{Name: "agent", Ready: false, RestartCount: 7},
					},
				},
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var rsLister appslisters.ReplicaSetLister
			got := projectPodAggregate(tc.pod, PodOwnerSources{ReplicaSets: rsLister})
			want := oraclePodAggregate(tc.pod, rsLister)
			if got != want {
				t.Fatalf("projectPodAggregate mismatch:\n got=%+v\nwant=%+v", got, want)
			}
		})
	}
}

// TestProjectPodAggregateWorkloadKindMatchesOverviewResolution proves the projected
// WorkloadKind equals exactly what cluster-overview's clusterOverviewWorkloadKind
// computes from the RS-list resolution (buildClusterOverviewReplicaSetDeploymentMap),
// for every owner shape: direct Deployment/DaemonSet/StatefulSet/Job, a ReplicaSet
// resolvable to a Deployment via the RS lister, a ReplicaSet with no Deployment owner,
// and an owner-less pod.
func TestProjectPodAggregateWorkloadKindMatchesOverviewResolution(t *testing.T) {
	rsWithDeploy := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: "team-a",
			Name:      "web-7d9c8b6f5",
			OwnerReferences: []metav1.OwnerReference{
				{Kind: "Deployment", Name: "web", Controller: ptrBool(true)},
			},
		},
	}
	rsNoDeploy := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: "team-a",
			Name:      "orphan-rs",
		},
	}
	rsLister := testsupport.NewReplicaSetLister(t, rsWithDeploy, rsNoDeploy)
	replicaSets := []*appsv1.ReplicaSet{rsWithDeploy, rsNoDeploy}
	rsMap := oracleClusterOverviewReplicaSetDeploymentMap(replicaSets)

	pod := func(ns, name string, owner metav1.OwnerReference) *corev1.Pod {
		return &corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Namespace:       ns,
				Name:            name,
				OwnerReferences: []metav1.OwnerReference{owner},
			},
		}
	}
	cases := []*corev1.Pod{
		pod("team-a", "deploy-rs-pod", metav1.OwnerReference{Kind: "ReplicaSet", Name: "web-7d9c8b6f5", Controller: ptrBool(true)}),
		pod("team-a", "orphan-rs-pod", metav1.OwnerReference{Kind: "ReplicaSet", Name: "orphan-rs", Controller: ptrBool(true)}),
		pod("kube-system", "ds-pod", metav1.OwnerReference{Kind: "DaemonSet", Name: "agent", Controller: ptrBool(true)}),
		pod("db", "sts-pod", metav1.OwnerReference{Kind: "StatefulSet", Name: "pg", Controller: ptrBool(true)}),
		pod("batch", "job-pod", metav1.OwnerReference{Kind: "Job", Name: "etl", Controller: ptrBool(true)}),
		{ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "standalone"}},
		pod("team-a", "noncontroller", metav1.OwnerReference{Kind: "Deployment", Name: "web"}),
	}
	for _, p := range cases {
		want := oracleClusterOverviewWorkloadKind(p, rsMap)
		got := projectPodAggregate(p, PodOwnerSources{ReplicaSets: rsLister}).WorkloadKind
		if got != want {
			t.Fatalf("pod %s/%s WorkloadKind = %q, want %q (overview resolution)", p.Namespace, p.Name, got, want)
		}
	}
}

// oraclePodAggregate recomputes the aggregate using the exact inline math the
// production domains use today, so the test fails if the projector diverges.
func oraclePodAggregate(pod *corev1.Pod, rsLister appslisters.ReplicaSetLister) streamrows.PodAggregate {
	agg := streamrows.PodAggregate{
		Namespace:          pod.Namespace,
		Name:               pod.Name,
		NodeName:           pod.Spec.NodeName,
		Phase:              string(pod.Status.Phase),
		ContainerCount:     len(pod.Spec.Containers),
		InitContainerCount: len(pod.Spec.InitContainers),
		OwnerKey:           ownerKeyForPod(pod),
		WorkloadKind:       oracleWorkloadKind(pod, rsLister),
		StatusPresentation: podres.BuildResourceModel("", pod).Status.Presentation,
	}

	// Regular-container resource sums (cluster_overview.go / nodes.go / workloads).
	for _, c := range pod.Spec.Containers {
		if cpu := c.Resources.Requests.Cpu(); cpu != nil {
			agg.CPURequestMilli += cpu.MilliValue()
		}
		if cpu := c.Resources.Limits.Cpu(); cpu != nil {
			agg.CPULimitMilli += cpu.MilliValue()
		}
		if mem := c.Resources.Requests.Memory(); mem != nil {
			agg.MemRequestBytes += mem.Value()
		}
		if mem := c.Resources.Limits.Memory(); mem != nil {
			agg.MemLimitBytes += mem.Value()
		}
	}
	// Init-container resource sums, kept separate.
	for _, c := range pod.Spec.InitContainers {
		if cpu := c.Resources.Requests.Cpu(); cpu != nil {
			agg.InitCPURequestMilli += cpu.MilliValue()
		}
		if cpu := c.Resources.Limits.Cpu(); cpu != nil {
			agg.InitCPULimitMilli += cpu.MilliValue()
		}
		if mem := c.Resources.Requests.Memory(); mem != nil {
			agg.InitMemRequestBytes += mem.Value()
		}
		if mem := c.Resources.Limits.Memory(); mem != nil {
			agg.InitMemLimitBytes += mem.Value()
		}
	}

	facts := podres.BuildFacts(pod)
	agg.ReadyContainers = facts.ReadyContainers
	agg.TotalContainers = facts.TotalContainers
	agg.RestartCountFacts = facts.RestartCount

	for _, s := range pod.Status.ContainerStatuses {
		agg.RestartCountContainersInit += s.RestartCount
	}
	for _, s := range pod.Status.InitContainerStatuses {
		agg.RestartCountContainersInit += s.RestartCount
	}

	return agg
}

// oracleClusterOverviewReplicaSetDeploymentMap is the prior cluster-overview RS->
// Deployment map (the resolution clusterOverviewWorkloadKind keyed off, before
// PodAggregate.WorkloadKind subsumed it). Kept here as the byte-equivalence oracle for
// the projected WorkloadKind.
func oracleClusterOverviewReplicaSetDeploymentMap(replicaSets []*appsv1.ReplicaSet) map[string]string {
	out := make(map[string]string, len(replicaSets))
	for _, replicaSet := range replicaSets {
		if replicaSet == nil {
			continue
		}
		for _, owner := range replicaSet.OwnerReferences {
			if owner.Controller == nil || !*owner.Controller || owner.Kind != "Deployment" || owner.Name == "" {
				continue
			}
			out[replicaSet.Namespace+"/"+replicaSet.Name] = owner.Name
			break
		}
	}
	return out
}

// oracleClusterOverviewWorkloadKind is the prior cluster-overview metrics-bucketing
// kind resolution (clusterOverviewWorkloadKind), kept as the byte-equivalence oracle
// for the projected WorkloadKind.
func oracleClusterOverviewWorkloadKind(pod *corev1.Pod, replicaSetDeployments map[string]string) string {
	if pod == nil {
		return ""
	}
	for _, owner := range pod.OwnerReferences {
		if owner.Controller == nil || !*owner.Controller {
			continue
		}
		switch owner.Kind {
		case "Deployment", "DaemonSet", "StatefulSet", "Job":
			return owner.Kind
		case "ReplicaSet":
			if _, ok := replicaSetDeployments[pod.Namespace+"/"+owner.Name]; ok {
				return "Deployment"
			}
		}
		return ""
	}
	return ""
}

// oracleWorkloadKind mirrors cluster-overview's prior clusterOverviewWorkloadKind, but
// resolves the ReplicaSet->Deployment relationship through the RS lister (the actual
// RS owner reference) the same way the prior RS-map resolution did.
func oracleWorkloadKind(pod *corev1.Pod, rsLister appslisters.ReplicaSetLister) string {
	for _, owner := range pod.OwnerReferences {
		if owner.Controller == nil || !*owner.Controller {
			continue
		}
		switch owner.Kind {
		case "Deployment", "DaemonSet", "StatefulSet", "Job":
			return owner.Kind
		case "ReplicaSet":
			if rsLister == nil {
				return ""
			}
			rs, err := rsLister.ReplicaSets(pod.Namespace).Get(owner.Name)
			if err != nil {
				return ""
			}
			for _, rsOwner := range rs.OwnerReferences {
				if rsOwner.Controller != nil && *rsOwner.Controller && rsOwner.Kind == "Deployment" {
					return "Deployment"
				}
			}
		}
		return ""
	}
	return ""
}

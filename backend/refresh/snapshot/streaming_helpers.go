package snapshot

import (
	"context"
	"errors"
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
)

// The new*Summary constructors fill the metadata fields every row of a given
// summary type shares (name/namespace/age from the object, plus kind/details).
// Each Build<Kind>Summary keeps its typed model + describe call and hands the
// result here, so the common row skeleton is declared once per summary type.

// BuildWorkloadSummary builds a workload row payload for a single workload object.
func BuildWorkloadSummary(
	meta ClusterMeta,
	obj interface{},
	pods []*corev1.Pod,
	usage map[string]metrics.PodUsage,
	hpas ...*autoscalingv1.HorizontalPodAutoscaler,
) (WorkloadSummary, error) {
	// Project the supplied typed pods to the PodAggregate rows the workload-summary
	// builders now consume (the same rows the ingest path supplies), grouping by the
	// owner key. WorkloadKind is unused by these builders, so a nil RS lister is correct.
	podsByOwner := make(map[string][]streamrows.PodAggregate)
	for _, pod := range pods {
		if pod == nil {
			continue
		}
		agg := projectPodAggregate(pod, nil)
		if agg.OwnerKey != "" {
			podsByOwner[agg.OwnerKey] = append(podsByOwner[agg.OwnerKey], agg)
		}
	}

	builder := NamespaceWorkloadsBuilder{}
	var summary WorkloadSummary

	switch typed := obj.(type) {
	case *appsv1.Deployment:
		summary = builder.buildDeploymentSummary(meta.ClusterID, typed, podsByOwner, usage)
	case *appsv1.StatefulSet:
		summary = builder.buildStatefulSetSummary(meta.ClusterID, typed, podsByOwner, usage)
	case *appsv1.DaemonSet:
		summary = builder.buildDaemonSetSummary(meta.ClusterID, typed, podsByOwner, usage)
	case *batchv1.Job:
		summary = builder.buildJobSummary(meta.ClusterID, typed, podsByOwner, usage)
	case *batchv1.CronJob:
		summary = builder.buildCronJobSummary(meta.ClusterID, typed, podsByOwner, usage)
	default:
		return WorkloadSummary{}, fmt.Errorf("unsupported workload type %T", obj)
	}

	summary.ClusterMeta = meta
	managed := false
	if _, ok := buildHPATargetSet(hpas)[workloadHPATargetKey(summary)]; ok {
		managed = true
	}
	summary.HPAManaged = &managed
	return summary, nil
}

// BuildStandalonePodWorkloadSummary builds a workload row payload for a standalone pod entry.
func BuildStandalonePodWorkloadSummary(
	meta ClusterMeta,
	pod *corev1.Pod,
	usage map[string]metrics.PodUsage,
	hpas ...*autoscalingv1.HorizontalPodAutoscaler,
) WorkloadSummary {
	summary := buildStandalonePodSummary(meta.ClusterID, pod, usage)
	summary.ClusterMeta = meta
	managed := false
	if _, ok := buildHPATargetSet(hpas)[workloadHPATargetKey(summary)]; ok {
		managed = true
	}
	summary.HPAManaged = &managed
	return summary
}

// BuildNodeSummary builds a node row payload from the supplied node, pod
// list, and pre-resolved metrics maps. The metrics-as-parameter contract
// (see resource-stream projection plan, Phase 5) keeps the projector
// deterministic: stream handlers fetch the latest usage snapshot once
// per event and pass it in, so parity tests can drive snapshot and
// stream paths with the same fixtures. Pass nil maps to render a node
// row without metrics — both maps are treated as empty.
func BuildNodeSummary(meta ClusterMeta, node *corev1.Node, pods []*corev1.Pod, nodeUsage map[string]metrics.NodeUsage, podUsage map[string]metrics.PodUsage) (NodeSummary, error) {
	if node == nil {
		return NodeSummary{}, errors.New("node is nil")
	}
	ctx := WithClusterMeta(context.Background(), meta)
	// Project the supplied typed pods to the PodAggregate rows buildNodeSnapshotFromUsage
	// now consumes (the same rows the ingest path supplies). WorkloadKind is unused by
	// the nodes domain, so a nil RS lister is correct here.
	aggregates := make([]streamrows.PodAggregate, 0, len(pods))
	for _, pod := range pods {
		if pod == nil {
			continue
		}
		aggregates = append(aggregates, projectPodAggregate(pod, nil))
	}
	// Scope "" carries no query string, so the parse cannot fail here.
	snap, err := buildNodeSnapshotFromUsage(ctx, "", []*corev1.Node{node}, aggregates, nodeUsageOrEmpty(nodeUsage), podUsageOrEmpty(podUsage))
	if err != nil {
		return NodeSummary{}, err
	}
	if snap == nil {
		return NodeSummary{}, errors.New("node snapshot unavailable")
	}
	payload, ok := snap.Payload.(NodeSnapshot)
	if !ok || len(payload.Rows) == 0 {
		return NodeSummary{}, errors.New("node summary unavailable")
	}
	return payload.Rows[0], nil
}

// WorkloadOwnerKey returns the canonical key used for workload pod grouping.
func WorkloadOwnerKey(kind, namespace, name string) string {
	return workloadOwnerKey(kind, namespace, name)
}

// WorkloadOwnerKeyForPod returns the canonical owner key for a pod in workload summaries.
func WorkloadOwnerKeyForPod(pod *corev1.Pod) string {
	return ownerKeyForPod(pod)
}

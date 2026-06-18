/*
 * backend/resources/statefulset/details.go
 *
 * StatefulSet resource handlers, co-located in the per-kind package.
 * - Builds the detail view for the frontend.
 *
 * Shared workload helpers (pod summaries, utilization, container/replica
 * formatting) live in resources/workloads and are imported here; StatefulSet's
 * intrinsic fields come from the single model (resourcemodel.StatefulSetFacts).
 */

package statefulset

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/pods"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	"github.com/luxury-yacht/app/backend/resources/workloads"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
)

// Service provides detailed StatefulSet views backed by shared dependencies.
type Service struct {
	deps common.Dependencies
}

// NewService constructs a StatefulSet service using the supplied dependencies bundle.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// StatefulSet returns the detailed view for a single StatefulSet.
func (s *Service) StatefulSet(namespace, name string) (*StatefulSetDetails, error) {
	client := s.deps.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	ss, err := client.AppsV1().StatefulSets(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get StatefulSet %s/%s: %v", namespace, name, err), logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to get statefulset: %v", err)
	}

	podsForSet, podMetrics, err := s.getStatefulSetPods(ss)
	if err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to collect pods for StatefulSet %s/%s: %v", namespace, name, err), logsources.ResourceLoader)
	}

	return s.buildStatefulSetDetails(ss, podsForSet, podMetrics), nil
}

func (s *Service) buildStatefulSetDetails(
	statefulSet *appsv1.StatefulSet,
	podsList []corev1.Pod,
	podMetrics map[string]*metricsv1beta1.PodMetrics,
) *StatefulSetDetails {
	model := BuildResourceModel(s.deps.ClusterID, statefulSet)
	facts := BuildFacts(statefulSet)
	replicas, ready := workloads.WorkloadReplicaDisplay(facts.WorkloadCommonFacts)
	podInfos := workloads.BuildPodSummaries(s.deps.ClusterID, "StatefulSet", statefulSet.Name, "apps/v1", podsList, podMetrics)
	podSummary, _ := workloads.SummarizePodMetrics(podsList, podMetrics)

	// Intrinsic spec/status fields come from the model facts (single extraction).
	// Complex sub-objects (PVC retention, volume claim templates) are navigated
	// here only to feed their shared formatters, which own that presentation.
	details := &StatefulSetDetails{
		Kind:                                 "StatefulSet",
		Name:                                 statefulSet.Name,
		Namespace:                            statefulSet.Namespace,
		StatusProjection:                     restypes.NewStatusProjection(model.Status),
		Replicas:                             replicas,
		Ready:                                ready,
		UpToDate:                             facts.UpdatedReplicas,
		Available:                            facts.AvailableReplicas,
		DesiredReplicas:                      facts.DesiredReplicas,
		Age:                                  common.FormatAge(statefulSet.CreationTimestamp.Time),
		ResourceUtilization:                  workloads.WorkloadUtilization(podsList, podMetrics),
		UpdateStrategy:                       facts.UpdateStrategy,
		Partition:                            facts.Partition,
		MaxUnavailable:                       facts.MaxUnavailable,
		PodManagementPolicy:                  facts.PodManagementPolicy,
		MinReadySeconds:                      facts.MinReadySeconds,
		RevisionHistoryLimit:                 facts.RevisionHistoryLimit,
		ServiceName:                          facts.ServiceName,
		ServiceAccount:                       facts.ServiceAccountName,
		NodeSelector:                         facts.NodeSelector,
		Tolerations:                          pods.FormatPodTolerations(facts.Tolerations),
		PersistentVolumeClaimRetentionPolicy: describePVCRetention(statefulSet.Spec.PersistentVolumeClaimRetentionPolicy),
		Selector:                             facts.Selector,
		Labels:                               statefulSet.Labels,
		Annotations:                          statefulSet.Annotations,
		Conditions:                           restypes.FormatConditions(facts.Conditions),
		Containers:                           workloads.DescribeContainers(facts.Containers),
		InitContainers:                       workloads.DescribeContainers(facts.InitContainers),
		VolumeClaimTemplates:                 describeVolumeClaimTemplates(statefulSet.Spec.VolumeClaimTemplates),
		Pods:                                 podInfos,
		PodMetricsSummary:                    podSummary,
		CurrentRevision:                      facts.StatusCurrentRevision,
		UpdateRevision:                       facts.StatusUpdateRevision,
		CurrentReplicas:                      facts.StatusCurrentReplicas,
		UpdatedReplicas:                      facts.UpdatedReplicas,
		ObservedGeneration:                   facts.ObservedGeneration,
		CollisionCount:                       facts.CollisionCount,
		Details:                              facts.ReadySummary,
	}

	return details
}

func (s *Service) getStatefulSetPods(statefulSet *appsv1.StatefulSet) ([]corev1.Pod, map[string]*metricsv1beta1.PodMetrics, error) {
	client := s.deps.KubernetesClient
	if client == nil {
		return nil, nil, fmt.Errorf("kubernetes client not initialized")
	}

	selector := labels.Set(statefulSet.Spec.Selector.MatchLabels).String()
	podList, err := client.CoreV1().Pods(statefulSet.Namespace).List(s.deps.Context, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return nil, nil, err
	}

	filtered := common.FilterPodsByControllerOwner(podList, "StatefulSet", statefulSet.Name)
	metrics := pods.NewService(s.deps).GetPodMetricsForPods(statefulSet.Namespace, filtered)

	return filtered, metrics, nil
}

func describeVolumeClaimTemplates(templates []corev1.PersistentVolumeClaim) []VolumeClaimTemplateSummary {
	if len(templates) == 0 {
		return nil
	}

	result := make([]VolumeClaimTemplateSummary, 0, len(templates))
	for _, template := range templates {
		summary := VolumeClaimTemplateSummary{
			Name: template.Name,
		}
		if template.Spec.StorageClassName != nil {
			summary.StorageClass = *template.Spec.StorageClassName
		}
		if storage, ok := template.Spec.Resources.Requests[corev1.ResourceStorage]; ok {
			summary.StorageRequest = storage.String()
		}
		if len(template.Spec.AccessModes) > 0 {
			summary.AccessModes = make([]string, 0, len(template.Spec.AccessModes))
			for _, mode := range template.Spec.AccessModes {
				summary.AccessModes = append(summary.AccessModes, string(mode))
			}
		}
		if template.Spec.VolumeMode != nil {
			summary.VolumeMode = string(*template.Spec.VolumeMode)
		}
		result = append(result, summary)
	}

	return result
}

func describePVCRetention(policy *appsv1.StatefulSetPersistentVolumeClaimRetentionPolicy) map[string]string {
	if policy == nil {
		return nil
	}

	result := make(map[string]string)
	if policy.WhenDeleted != "" {
		result["whenDeleted"] = string(policy.WhenDeleted)
	}
	if policy.WhenScaled != "" {
		result["whenScaled"] = string(policy.WhenScaled)
	}
	return result
}

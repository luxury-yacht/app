/*
 * backend/resources/workloads/statefulsets.go
 *
 * StatefulSet resource handlers.
 * - Builds detail and list views for the frontend.
 */

package workloads

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/pods"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
)

type StatefulSetService struct {
	deps common.Dependencies
}

func NewStatefulSetService(deps common.Dependencies) *StatefulSetService {
	return &StatefulSetService{deps: deps}
}

func (s *StatefulSetService) StatefulSet(namespace, name string) (*restypes.StatefulSetDetails, error) {
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

func (s *StatefulSetService) buildStatefulSetDetails(
	statefulSet *appsv1.StatefulSet,
	podsList []corev1.Pod,
	podMetrics map[string]*metricsv1beta1.PodMetrics,
) *restypes.StatefulSetDetails {
	model := resourcemodel.BuildStatefulSetResourceModel(s.deps.ClusterID, statefulSet)
	facts := model.Facts.StatefulSet
	replicas, ready := workloadReplicaDisplay(facts.WorkloadCommonFacts)
	podInfos := buildPodSummaries(s.deps.ClusterID, "StatefulSet", statefulSet.Name, "apps/v1", podsList, podMetrics)
	podSummary, _ := summarizePodMetrics(podsList, podMetrics)

	// Intrinsic spec/status fields come from the model facts (single extraction).
	// Complex sub-objects (PVC retention, volume claim templates) are navigated
	// here only to feed their shared formatters, which own that presentation.
	details := &restypes.StatefulSetDetails{
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
		ResourceUtilization:                  workloadUtilization(podsList, podMetrics),
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
		Containers:                           describeContainers(facts.Containers),
		InitContainers:                       describeContainers(facts.InitContainers),
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

func (s *StatefulSetService) getStatefulSetPods(statefulSet *appsv1.StatefulSet) ([]corev1.Pod, map[string]*metricsv1beta1.PodMetrics, error) {
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

func describeVolumeClaimTemplates(templates []corev1.PersistentVolumeClaim) []restypes.VolumeClaimTemplateSummary {
	if len(templates) == 0 {
		return nil
	}

	result := make([]restypes.VolumeClaimTemplateSummary, 0, len(templates))
	for _, template := range templates {
		summary := restypes.VolumeClaimTemplateSummary{
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


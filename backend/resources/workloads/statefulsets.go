package workloads

import (
	"fmt"

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
		s.deps.Logger.Error(fmt.Sprintf("Failed to get StatefulSet %s/%s: %v", namespace, name, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to get statefulset: %v", err)
	}

	podsForSet, podMetrics, err := s.getStatefulSetPods(ss)
	if err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to collect pods for StatefulSet %s/%s: %v", namespace, name, err), "ResourceLoader")
	}

	return s.buildStatefulSetDetails(ss, podsForSet, podMetrics), nil
}

func (s *StatefulSetService) StatefulSets(namespace string) ([]*restypes.StatefulSetDetails, error) {
	client := s.deps.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	statefulSets, err := client.AppsV1().StatefulSets(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to list StatefulSets in namespace %s: %v", namespace, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to list statefulsets: %v", err)
	}

	podList, err := client.CoreV1().Pods(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to list pods in namespace %s: %v", namespace, err), "ResourceLoader")
	}

	podService := pods.NewService(s.deps)
	var metricsByPod map[string]*metricsv1beta1.PodMetrics
	if podList != nil {
		metricsByPod = podService.GetPodMetricsForPods(namespace, podList.Items)
	}

	var results []*restypes.StatefulSetDetails
	for i := range statefulSets.Items {
		ss := &statefulSets.Items[i]
		filteredPods := filterPodsForStatefulSet(ss, podList)
		details := s.buildStatefulSetDetails(ss, filteredPods, metricsByPod)
		results = append(results, details)
	}

	return results, nil
}

func (s *StatefulSetService) buildStatefulSetDetails(
	statefulSet *appsv1.StatefulSet,
	podsList []corev1.Pod,
	podMetrics map[string]*metricsv1beta1.PodMetrics,
) *restypes.StatefulSetDetails {
	avgCPURequest, avgCPULimit, avgMemRequest, avgMemLimit, avgCPUUsage, avgMemUsage := aggregatePodAverages(podsList, podMetrics)
	podInfos := buildPodSummaries("StatefulSet", statefulSet.Name, podsList, podMetrics)
	podSummary, _ := summarizePodMetrics(podsList, podMetrics)

	desiredReplicas := int32(0)
	if statefulSet.Spec.Replicas != nil {
		desiredReplicas = *statefulSet.Spec.Replicas
	}

	revisionHistory := int32(0)
	if statefulSet.Spec.RevisionHistoryLimit != nil {
		revisionHistory = *statefulSet.Spec.RevisionHistoryLimit
	}

	maxUnavailable := ""
	var partition *int32
	if ru := statefulSet.Spec.UpdateStrategy.RollingUpdate; ru != nil {
		if ru.MaxUnavailable != nil {
			maxUnavailable = ru.MaxUnavailable.String()
		}
		partition = ru.Partition
	}

	details := &restypes.StatefulSetDetails{
		Kind:                                 "StatefulSet",
		Name:                                 statefulSet.Name,
		Namespace:                            statefulSet.Namespace,
		Replicas:                             fmt.Sprintf("%d/%d", statefulSet.Status.Replicas, desiredReplicas),
		Ready:                                fmt.Sprintf("%d/%d", statefulSet.Status.ReadyReplicas, statefulSet.Status.Replicas),
		UpToDate:                             statefulSet.Status.UpdatedReplicas,
		Available:                            statefulSet.Status.AvailableReplicas,
		DesiredReplicas:                      desiredReplicas,
		Age:                                  common.FormatAge(statefulSet.CreationTimestamp.Time),
		CPURequest:                           common.FormatCPU(avgCPURequest),
		CPULimit:                             common.FormatCPU(avgCPULimit),
		CPUUsage:                             common.FormatCPU(avgCPUUsage),
		MemRequest:                           common.FormatMemory(avgMemRequest),
		MemLimit:                             common.FormatMemory(avgMemLimit),
		MemUsage:                             common.FormatMemory(avgMemUsage),
		UpdateStrategy:                       string(statefulSet.Spec.UpdateStrategy.Type),
		Partition:                            partition,
		MaxUnavailable:                       maxUnavailable,
		PodManagementPolicy:                  string(statefulSet.Spec.PodManagementPolicy),
		MinReadySeconds:                      statefulSet.Spec.MinReadySeconds,
		RevisionHistoryLimit:                 revisionHistory,
		ServiceName:                          statefulSet.Spec.ServiceName,
		PersistentVolumeClaimRetentionPolicy: describePVCRetention(statefulSet.Spec.PersistentVolumeClaimRetentionPolicy),
		Selector:                             statefulSet.Spec.Selector.MatchLabels,
		Labels:                               statefulSet.Labels,
		Annotations:                          statefulSet.Annotations,
		Conditions:                           describeStatefulSetConditions(statefulSet),
		Containers:                           describeContainers(statefulSet.Spec.Template.Spec.Containers),
		VolumeClaimTemplates:                 describeVolumeClaimTemplates(statefulSet.Spec.VolumeClaimTemplates),
		Pods:                                 podInfos,
		PodMetricsSummary:                    podSummary,
		CurrentRevision:                      statefulSet.Status.CurrentRevision,
		UpdateRevision:                       statefulSet.Status.UpdateRevision,
		CurrentReplicas:                      statefulSet.Status.CurrentReplicas,
		UpdatedReplicas:                      statefulSet.Status.UpdatedReplicas,
		ObservedGeneration:                   statefulSet.Status.ObservedGeneration,
		CollisionCount:                       statefulSet.Status.CollisionCount,
	}

	details.Details = summarizeStatefulSet(statefulSet)
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

	filtered := filterPodsForStatefulSet(statefulSet, podList)
	metrics := pods.NewService(s.deps).GetPodMetricsForPods(statefulSet.Namespace, filtered)

	return filtered, metrics, nil
}

func filterPodsForStatefulSet(statefulSet *appsv1.StatefulSet, podList *corev1.PodList) []corev1.Pod {
	if podList == nil {
		return nil
	}

	var filtered []corev1.Pod
	for _, pod := range podList.Items {
		for _, owner := range pod.OwnerReferences {
			if owner.Controller != nil && *owner.Controller && owner.Kind == "StatefulSet" && owner.Name == statefulSet.Name {
				filtered = append(filtered, pod)
				break
			}
		}
	}
	return filtered
}

func describeStatefulSetConditions(statefulSet *appsv1.StatefulSet) []string {
	conditions := make([]string, 0, len(statefulSet.Status.Conditions))
	for _, cond := range statefulSet.Status.Conditions {
		condStr := fmt.Sprintf("%s: %s", cond.Type, cond.Status)
		if cond.Reason != "" {
			condStr += fmt.Sprintf(" (%s)", cond.Reason)
		}
		if cond.Message != "" {
			condStr += fmt.Sprintf(" - %s", cond.Message)
		}
		conditions = append(conditions, condStr)
	}
	return conditions
}

func describeVolumeClaimTemplates(templates []corev1.PersistentVolumeClaim) []string {
	if len(templates) == 0 {
		return nil
	}

	result := make([]string, 0, len(templates))
	for _, template := range templates {
		info := template.Name
		if template.Spec.StorageClassName != nil {
			info += fmt.Sprintf(" (%s)", *template.Spec.StorageClassName)
		}
		if storage, ok := template.Spec.Resources.Requests[corev1.ResourceStorage]; ok {
			info += fmt.Sprintf(" - %s", storage.String())
		}
		result = append(result, info)
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

func summarizeStatefulSet(statefulSet *appsv1.StatefulSet) string {
	replicaInfo := fmt.Sprintf("Ready: %d/%d", statefulSet.Status.ReadyReplicas, statefulSet.Status.Replicas)
	if statefulSet.Spec.Replicas != nil && *statefulSet.Spec.Replicas != statefulSet.Status.Replicas {
		replicaInfo = fmt.Sprintf("Ready: %d/%d (desired: %d)", statefulSet.Status.ReadyReplicas, statefulSet.Status.Replicas, *statefulSet.Spec.Replicas)
	}

	serviceInfo := fmt.Sprintf(", Service: %s", statefulSet.Spec.ServiceName)

	volumeInfo := ""
	if len(statefulSet.Spec.VolumeClaimTemplates) > 0 {
		volumeInfo = fmt.Sprintf(", %d PVC template(s)", len(statefulSet.Spec.VolumeClaimTemplates))
	}

	return fmt.Sprintf("%s%s%s", replicaInfo, serviceInfo, volumeInfo)
}

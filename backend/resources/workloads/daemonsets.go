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

type DaemonSetService struct {
	deps common.Dependencies
}

func NewDaemonSetService(deps common.Dependencies) *DaemonSetService {
	return &DaemonSetService{deps: deps}
}

func (s *DaemonSetService) DaemonSet(namespace, name string) (*restypes.DaemonSetDetails, error) {
	client := s.deps.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	ds, err := client.AppsV1().DaemonSets(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get DaemonSet %s/%s: %v", namespace, name, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to get daemonset: %v", err)
	}

	podsForSet, podMetrics, err := s.getDaemonSetPods(ds)
	if err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to collect pods for DaemonSet %s/%s: %v", namespace, name, err), "ResourceLoader")
	}

	return s.buildDaemonSetDetails(ds, podsForSet, podMetrics), nil
}

func (s *DaemonSetService) DaemonSets(namespace string) ([]*restypes.DaemonSetDetails, error) {
	client := s.deps.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	daemonSets, err := client.AppsV1().DaemonSets(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to list DaemonSets in namespace %s: %v", namespace, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to list daemonsets: %v", err)
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

	var results []*restypes.DaemonSetDetails
	for i := range daemonSets.Items {
		ds := &daemonSets.Items[i]
		filteredPods := filterPodsForDaemonSet(ds, podList)
		details := s.buildDaemonSetDetails(ds, filteredPods, metricsByPod)
		results = append(results, details)
	}

	return results, nil
}

func (s *DaemonSetService) buildDaemonSetDetails(
	daemonSet *appsv1.DaemonSet,
	podsList []corev1.Pod,
	podMetrics map[string]*metricsv1beta1.PodMetrics,
) *restypes.DaemonSetDetails {
	avgCPURequest, avgCPULimit, avgMemRequest, avgMemLimit, avgCPUUsage, avgMemUsage := aggregatePodAverages(podsList, podMetrics)
	podInfos := buildPodSummaries("DaemonSet", daemonSet.Name, podsList, podMetrics)
	podSummary, _ := summarizePodMetrics(podsList, podMetrics)

	details := &restypes.DaemonSetDetails{
		Kind:            "DaemonSet",
		Name:            daemonSet.Name,
		Namespace:       daemonSet.Namespace,
		Details:         "",
		Desired:         daemonSet.Status.DesiredNumberScheduled,
		Current:         daemonSet.Status.CurrentNumberScheduled,
		Ready:           daemonSet.Status.NumberReady,
		UpToDate:        daemonSet.Status.UpdatedNumberScheduled,
		Available:       daemonSet.Status.NumberAvailable,
		Age:             common.FormatAge(daemonSet.CreationTimestamp.Time),
		CPURequest:      common.FormatCPU(avgCPURequest),
		CPULimit:        common.FormatCPU(avgCPULimit),
		CPUUsage:        common.FormatCPU(avgCPUUsage),
		MemRequest:      common.FormatMemory(avgMemRequest),
		MemLimit:        common.FormatMemory(avgMemLimit),
		MemUsage:        common.FormatMemory(avgMemUsage),
		UpdateStrategy:  string(daemonSet.Spec.UpdateStrategy.Type),
		MaxUnavailable:  describeOptionalValue(daemonSet.Spec.UpdateStrategy.RollingUpdate, true),
		MaxSurge:        describeOptionalValue(daemonSet.Spec.UpdateStrategy.RollingUpdate, false),
		MinReadySeconds: daemonSet.Spec.MinReadySeconds,
		RevisionHistoryLimit: func() int32 {
			if daemonSet.Spec.RevisionHistoryLimit != nil {
				return *daemonSet.Spec.RevisionHistoryLimit
			}
			return 0
		}(),
		Selector:           daemonSet.Spec.Selector.MatchLabels,
		Labels:             daemonSet.Labels,
		Annotations:        daemonSet.Annotations,
		NodeSelector:       daemonSet.Spec.Template.Spec.NodeSelector,
		Conditions:         describeDaemonSetConditions(daemonSet),
		Containers:         describeContainers(daemonSet.Spec.Template.Spec.Containers),
		Pods:               podInfos,
		PodMetricsSummary:  podSummary,
		ObservedGeneration: daemonSet.Status.ObservedGeneration,
		NumberMisscheduled: daemonSet.Status.NumberMisscheduled,
		CollisionCount:     daemonSet.Status.CollisionCount,
	}

	details.Details = summarizeDaemonSet(daemonSet)
	return details
}

func (s *DaemonSetService) getDaemonSetPods(daemonSet *appsv1.DaemonSet) ([]corev1.Pod, map[string]*metricsv1beta1.PodMetrics, error) {
	client := s.deps.KubernetesClient
	if client == nil {
		return nil, nil, fmt.Errorf("kubernetes client not initialized")
	}

	selector := labels.Set(daemonSet.Spec.Selector.MatchLabels).String()
	podList, err := client.CoreV1().Pods(daemonSet.Namespace).List(s.deps.Context, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return nil, nil, err
	}

	filtered := filterPodsForDaemonSet(daemonSet, podList)
	metrics := pods.NewService(s.deps).GetPodMetricsForPods(daemonSet.Namespace, filtered)
	return filtered, metrics, nil
}

func describeOptionalValue(rollingUpdate *appsv1.RollingUpdateDaemonSet, extractMaxUnavailable bool) string {
	if rollingUpdate == nil {
		return ""
	}
	if extractMaxUnavailable {
		if rollingUpdate.MaxUnavailable != nil {
			return rollingUpdate.MaxUnavailable.String()
		}
	} else {
		if rollingUpdate.MaxSurge != nil {
			return rollingUpdate.MaxSurge.String()
		}
	}
	return ""
}

func describeDaemonSetConditions(daemonSet *appsv1.DaemonSet) []string {
	conditions := make([]string, 0, len(daemonSet.Status.Conditions))
	for _, cond := range daemonSet.Status.Conditions {
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

func summarizeDaemonSet(daemonSet *appsv1.DaemonSet) string {
	summary := fmt.Sprintf("Desired: %d, Current: %d, Ready: %d", daemonSet.Status.DesiredNumberScheduled, daemonSet.Status.CurrentNumberScheduled, daemonSet.Status.NumberReady)
	if daemonSet.Status.NumberUnavailable > 0 {
		summary += fmt.Sprintf(", Unavailable: %d", daemonSet.Status.NumberUnavailable)
	}
	if daemonSet.Status.NumberMisscheduled > 0 {
		summary += fmt.Sprintf(", Misscheduled: %d", daemonSet.Status.NumberMisscheduled)
	}
	return summary
}

func filterPodsForDaemonSet(daemonSet *appsv1.DaemonSet, podList *corev1.PodList) []corev1.Pod {
	if podList == nil {
		return nil
	}

	var filtered []corev1.Pod
	for _, pod := range podList.Items {
		for _, owner := range pod.OwnerReferences {
			if owner.Controller != nil && *owner.Controller && owner.Kind == "DaemonSet" && owner.Name == daemonSet.Name {
				filtered = append(filtered, pod)
				break
			}
		}
	}
	return filtered
}

/*
 * backend/resources/workloads/daemonsets.go
 *
 * DaemonSet resource handlers.
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
		s.deps.Logger.Error(fmt.Sprintf("Failed to get DaemonSet %s/%s: %v", namespace, name, err), logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to get daemonset: %v", err)
	}

	podsForSet, podMetrics, err := s.getDaemonSetPods(ds)
	if err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to collect pods for DaemonSet %s/%s: %v", namespace, name, err), logsources.ResourceLoader)
	}

	return s.buildDaemonSetDetails(ds, podsForSet, podMetrics), nil
}

func (s *DaemonSetService) buildDaemonSetDetails(
	daemonSet *appsv1.DaemonSet,
	podsList []corev1.Pod,
	podMetrics map[string]*metricsv1beta1.PodMetrics,
) *restypes.DaemonSetDetails {
	model := resourcemodel.BuildDaemonSetResourceModel(s.deps.ClusterID, daemonSet)
	facts := model.Facts.DaemonSet
	podInfos := BuildPodSummaries(s.deps.ClusterID, "DaemonSet", daemonSet.Name, "apps/v1", podsList, podMetrics)
	podSummary, _ := SummarizePodMetrics(podsList, podMetrics)

	// All intrinsic spec/status fields come from the model facts (single extraction).
	details := &restypes.DaemonSetDetails{
		Kind:                 "DaemonSet",
		Name:                 daemonSet.Name,
		Namespace:            daemonSet.Namespace,
		StatusProjection:     restypes.NewStatusProjection(model.Status),
		Details:              facts.ReadySummary,
		Desired:              facts.DesiredReplicas,
		Current:              facts.CurrentReplicas,
		Ready:                facts.ReadyReplicas,
		UpToDate:             facts.UpdatedReplicas,
		Available:            facts.AvailableReplicas,
		Age:                  common.FormatAge(daemonSet.CreationTimestamp.Time),
		ResourceUtilization:  WorkloadUtilization(podsList, podMetrics),
		UpdateStrategy:       facts.UpdateStrategy,
		MaxUnavailable:       facts.MaxUnavailable,
		MaxSurge:             facts.MaxSurge,
		MinReadySeconds:      facts.MinReadySeconds,
		RevisionHistoryLimit: facts.RevisionHistoryLimit,
		ServiceAccount:       facts.ServiceAccountName,
		Selector:             facts.Selector,
		Labels:               daemonSet.Labels,
		Annotations:          daemonSet.Annotations,
		NodeSelector:         facts.NodeSelector,
		Tolerations:          pods.FormatPodTolerations(facts.Tolerations),
		Conditions:           restypes.FormatConditions(facts.Conditions),
		Containers:           DescribeContainers(facts.Containers),
		InitContainers:       DescribeContainers(facts.InitContainers),
		Pods:                 podInfos,
		PodMetricsSummary:    podSummary,
		ObservedGeneration:   facts.ObservedGeneration,
		NumberMisscheduled:   facts.NumberMisscheduled,
		CollisionCount:       facts.CollisionCount,
	}

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

	filtered := common.FilterPodsByControllerOwner(podList, "DaemonSet", daemonSet.Name)
	metrics := pods.NewService(s.deps).GetPodMetricsForPods(daemonSet.Namespace, filtered)
	return filtered, metrics, nil
}


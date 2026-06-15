/*
 * backend/resources/daemonset/details.go
 *
 * DaemonSet resource handlers, co-located in the per-kind package. Shared
 * workload helpers live in resources/workloads; intrinsic fields come from the
 * single model (daemonset.Facts).
 */

package daemonset

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

// Service provides detailed DaemonSet views backed by shared dependencies.
type Service struct {
	deps common.Dependencies
}

// NewService constructs a DaemonSet service using the supplied dependencies bundle.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// DaemonSet returns the detailed view for a single daemonset.
func (s *Service) DaemonSet(namespace, name string) (*DaemonSetDetails, error) {
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

func (s *Service) buildDaemonSetDetails(
	daemonSet *appsv1.DaemonSet,
	podsList []corev1.Pod,
	podMetrics map[string]*metricsv1beta1.PodMetrics,
) *DaemonSetDetails {
	model := BuildResourceModel(s.deps.ClusterID, daemonSet)
	facts := BuildFacts(daemonSet)
	podInfos := workloads.BuildPodSummaries(s.deps.ClusterID, "DaemonSet", daemonSet.Name, "apps/v1", podsList, podMetrics)
	podSummary, _ := workloads.SummarizePodMetrics(podsList, podMetrics)

	// All intrinsic spec/status fields come from the model facts (single extraction).
	details := &DaemonSetDetails{
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
		ResourceUtilization:  workloads.WorkloadUtilization(podsList, podMetrics),
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
		Containers:           workloads.DescribeContainers(facts.Containers),
		InitContainers:       workloads.DescribeContainers(facts.InitContainers),
		Pods:                 podInfos,
		PodMetricsSummary:    podSummary,
		ObservedGeneration:   facts.ObservedGeneration,
		NumberMisscheduled:   facts.NumberMisscheduled,
		CollisionCount:       facts.CollisionCount,
	}

	return details
}

func (s *Service) getDaemonSetPods(daemonSet *appsv1.DaemonSet) ([]corev1.Pod, map[string]*metricsv1beta1.PodMetrics, error) {
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

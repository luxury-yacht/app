/*
 * backend/resources/replicaset/details.go
 *
 * ReplicaSet resource handlers, co-located in the per-kind package. Shared
 * workload helpers live in resources/workloads; intrinsic fields come from the
 * single model (replicaset.Facts).
 */

package replicaset

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

// Service provides detailed ReplicaSet views backed by shared dependencies.
type Service struct {
	deps common.Dependencies
}

// NewService constructs a ReplicaSet service using the supplied dependencies bundle.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// ReplicaSet returns the detailed view for a single ReplicaSet.
func (s *Service) ReplicaSet(namespace, name string) (*ReplicaSetDetails, error) {
	client := s.deps.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	replicaSet, err := client.AppsV1().ReplicaSets(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get ReplicaSet %s/%s: %v", namespace, name, err), logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to get replicaset: %v", err)
	}

	podsForSet, podMetrics, err := s.getReplicaSetPods(replicaSet)
	if err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to collect pods for ReplicaSet %s/%s: %v", namespace, name, err), logsources.ResourceLoader)
	}

	return s.buildReplicaSetDetails(replicaSet, podsForSet, podMetrics), nil
}

func (s *Service) buildReplicaSetDetails(
	replicaSet *appsv1.ReplicaSet,
	podsList []corev1.Pod,
	podMetrics map[string]*metricsv1beta1.PodMetrics,
) *ReplicaSetDetails {
	model := BuildResourceModel(s.deps.ClusterID, replicaSet)
	facts := BuildFacts(replicaSet)
	replicas, ready := workloads.WorkloadReplicaDisplay(facts.WorkloadCommonFacts)
	podInfos := workloads.BuildPodSummaries(s.deps.ClusterID, "ReplicaSet", replicaSet.Name, "apps/v1", podsList, podMetrics)
	podSummary, _ := workloads.SummarizePodMetrics(podsList, podMetrics)

	details := &ReplicaSetDetails{
		Kind:                "ReplicaSet",
		Name:                replicaSet.Name,
		Namespace:           replicaSet.Namespace,
		StatusProjection:    restypes.NewStatusProjection(model.Status),
		Details:             facts.ReadySummary,
		Replicas:            replicas,
		Ready:               ready,
		Available:           facts.AvailableReplicas,
		DesiredReplicas:     facts.DesiredReplicas,
		Age:                 common.FormatAge(replicaSet.CreationTimestamp.Time),
		ResourceUtilization: workloads.WorkloadUtilization(podsList, podMetrics),
		MinReadySeconds:     facts.MinReadySeconds,
		Selector:            facts.Selector,
		Labels:              replicaSet.Labels,
		Annotations:         replicaSet.Annotations,
		Conditions:          restypes.FormatConditions(facts.Conditions),
		Containers:          workloads.DescribeContainers(facts.Containers),
		InitContainers:      workloads.DescribeContainers(facts.InitContainers),
		Pods:                podInfos,
		PodMetricsSummary:   podSummary,
		ObservedGeneration:  facts.ObservedGeneration,
		// IsActive needs a live deployment lookup, so it stays here (not intrinsic).
		IsActive: s.isReplicaSetActive(replicaSet),
	}

	return details
}

func (s *Service) getReplicaSetPods(replicaSet *appsv1.ReplicaSet) ([]corev1.Pod, map[string]*metricsv1beta1.PodMetrics, error) {
	client := s.deps.KubernetesClient
	if client == nil {
		return nil, nil, fmt.Errorf("kubernetes client not initialized")
	}

	selector := labels.Set(replicaSet.Spec.Selector.MatchLabels).String()
	podList, err := client.CoreV1().Pods(replicaSet.Namespace).List(s.deps.Context, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return nil, nil, err
	}

	filtered := filterPodsForReplicaSet(replicaSet, podList)
	metrics := pods.NewService(s.deps).GetPodMetricsForPods(replicaSet.Namespace, filtered)
	return filtered, metrics, nil
}

func (s *Service) isReplicaSetActive(replicaSet *appsv1.ReplicaSet) bool {
	deploymentName := replicaSetDeploymentName(replicaSet)
	if deploymentName == "" {
		return true
	}

	replicaSetRevision := revisionFromAnnotations(replicaSet.Annotations)
	if replicaSetRevision == "" {
		return true
	}

	// Only hide utilization when we can confirm this ReplicaSet is not the active deployment revision.
	client := s.deps.KubernetesClient
	if client == nil {
		return true
	}

	deployment, err := client.AppsV1().Deployments(replicaSet.Namespace).Get(s.deps.Context, deploymentName, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Debug(fmt.Sprintf("Failed to fetch deployment %s/%s for ReplicaSet activity: %v", replicaSet.Namespace, deploymentName, err), logsources.ResourceLoader)
		return true
	}

	deploymentRevision := revisionFromAnnotations(deployment.Annotations)
	if deploymentRevision == "" {
		return true
	}

	return replicaSetRevision == deploymentRevision
}

// filterPodsForReplicaSet keeps pods owned by the target ReplicaSet.
func filterPodsForReplicaSet(replicaSet *appsv1.ReplicaSet, podList *corev1.PodList) []corev1.Pod {
	if podList == nil {
		return nil
	}

	var filtered []corev1.Pod
	for _, pod := range podList.Items {
		for _, owner := range pod.OwnerReferences {
			if owner.Kind != "ReplicaSet" {
				continue
			}
			if owner.UID != "" && owner.UID != replicaSet.UID {
				continue
			}
			if owner.Name == replicaSet.Name {
				filtered = append(filtered, pod)
				break
			}
		}
	}

	return filtered
}

func replicaSetDeploymentName(replicaSet *appsv1.ReplicaSet) string {
	for _, owner := range replicaSet.OwnerReferences {
		if owner.Kind != "Deployment" {
			continue
		}
		if owner.Controller != nil && !*owner.Controller {
			continue
		}
		return owner.Name
	}
	return ""
}

func revisionFromAnnotations(annotations map[string]string) string {
	if len(annotations) == 0 {
		return ""
	}
	return annotations["deployment.kubernetes.io/revision"]
}

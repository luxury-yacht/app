/*
 * backend/resources/deployment/details.go
 *
 * Deployment resource handlers, co-located in the per-kind package. Shared
 * workload helpers live in resources/workloads; intrinsic fields come from the
 * single model (deployment.Facts).
 */

package deployment

import (
	"fmt"
	"sort"

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

// Service provides detailed Deployment views backed by shared dependencies.
type Service struct {
	deps common.Dependencies
}

// NewService constructs a Deployment service using the supplied dependencies bundle.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// Deployment returns the detailed view for a single deployment.
func (s *Service) Deployment(namespace, name string) (*DeploymentDetails, error) {
	client := s.deps.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	deployment, err := client.AppsV1().Deployments(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get deployment %s/%s: %v", namespace, name, err), logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to get deployment: %v", err)
	}

	// getDeploymentPods also fetches ReplicaSets for filtering; reuse them to avoid a second list call.
	deploymentPods, podMetrics, replicaSets, err := s.getDeploymentPods(deployment)
	if err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to collect pods for deployment %s/%s: %v", namespace, name, err), logsources.ResourceLoader)
	}

	return s.buildDeploymentDetails(deployment, deploymentPods, podMetrics, replicaSets), nil
}

func (s *Service) buildDeploymentDetails(
	deployment *appsv1.Deployment,
	podsList []corev1.Pod,
	podMetrics map[string]*metricsv1beta1.PodMetrics,
	replicaSets *appsv1.ReplicaSetList,
) *DeploymentDetails {
	model := BuildResourceModel(s.deps.ClusterID, deployment)
	facts := BuildFacts(deployment)
	replicas, ready := workloads.WorkloadReplicaDisplay(facts.WorkloadCommonFacts)
	podInfos := workloads.BuildPodSummaries(s.deps.ClusterID, "Deployment", deployment.Name, "apps/v1", podsList, podMetrics)
	podSummary, _ := workloads.SummarizePodMetrics(podsList, podMetrics)

	// Live aggregation (not part of the resource's intrinsic definition).
	rsNames, currentRevision, currentRSName := summarizeReplicaSets(deployment, replicaSets)

	details := &DeploymentDetails{
		Kind:                "Deployment",
		Name:                deployment.Name,
		Namespace:           deployment.Namespace,
		StatusProjection:    restypes.NewStatusProjection(model.Status),
		Replicas:            replicas,
		Ready:               ready,
		UpToDate:            facts.UpdatedReplicas,
		Available:           facts.AvailableReplicas,
		DesiredReplicas:     facts.DesiredReplicas,
		Age:                 common.FormatAge(deployment.CreationTimestamp.Time),
		ResourceUtilization: workloads.WorkloadUtilization(podsList, podMetrics),
		Strategy:            facts.Strategy,
		MaxSurge:            facts.MaxSurge,
		MaxUnavailable:      facts.MaxUnavailable,
		MinReadySeconds:     facts.MinReadySeconds,
		RevisionHistory:     facts.RevisionHistory,
		ProgressDeadline:    facts.ProgressDeadline,
		ServiceAccount:      facts.ServiceAccountName,
		NodeSelector:        facts.NodeSelector,
		Tolerations:         pods.FormatPodTolerations(facts.Tolerations),
		Selector:            facts.Selector,
		Labels:              deployment.Labels,
		Annotations:         deployment.Annotations,
		Containers:          workloads.DescribeContainers(facts.Containers),
		InitContainers:      workloads.DescribeContainers(facts.InitContainers),
		Pods:                podInfos,
		CurrentRevision:     currentRevision,
		CurrentReplicaSet:   currentRSName,
		ReplicaSets:         rsNames,
		ObservedGeneration:  facts.ObservedGeneration,
		Paused:              facts.Paused,
	}

	details.Conditions = restypes.FormatConditions(facts.Conditions)
	details.RolloutStatus = facts.RolloutStatus
	details.RolloutMessage = facts.RolloutMessage
	details.Details = facts.ReadySummary
	details.PodMetricsSummary = podSummary

	return details
}

func (s *Service) getDeploymentPods(deployment *appsv1.Deployment) ([]corev1.Pod, map[string]*metricsv1beta1.PodMetrics, *appsv1.ReplicaSetList, error) {
	client := s.deps.KubernetesClient
	if client == nil {
		return nil, nil, nil, fmt.Errorf("kubernetes client not initialized")
	}

	labelSelector := labels.Set(deployment.Spec.Selector.MatchLabels).String()
	podList, err := client.CoreV1().Pods(deployment.Namespace).List(s.deps.Context, metav1.ListOptions{LabelSelector: labelSelector})
	if err != nil {
		return nil, nil, nil, err
	}

	replicaSets, err := client.AppsV1().ReplicaSets(deployment.Namespace).List(s.deps.Context, metav1.ListOptions{LabelSelector: labelSelector})
	if err != nil {
		replicaSets = nil
	}

	filteredPods := filterPodsForDeployment(deployment, podList, replicaSets)
	metrics := pods.NewService(s.deps).GetPodMetricsForPods(deployment.Namespace, filteredPods)

	return filteredPods, metrics, replicaSets, nil
}

func summarizeReplicaSets(deployment *appsv1.Deployment, replicaSets *appsv1.ReplicaSetList) ([]string, string, string) {
	if replicaSets == nil {
		return nil, "", ""
	}

	var names []string
	var currentRevision string
	var currentRSName string
	deploymentRevision := deployment.Annotations["deployment.kubernetes.io/revision"]

	for _, rs := range replicaSets.Items {
		for _, owner := range rs.OwnerReferences {
			if owner.UID == deployment.UID {
				names = append(names, rs.Name)
				if revision, ok := rs.Annotations["deployment.kubernetes.io/revision"]; ok {
					if deploymentRevision != "" && revision == deploymentRevision {
						currentRevision = revision
						currentRSName = rs.Name
					}
				}
				break
			}
		}
	}

	sort.Strings(names)
	return names, currentRevision, currentRSName
}

func filterPodsForDeployment(
	deployment *appsv1.Deployment,
	podList *corev1.PodList,
	replicaSets *appsv1.ReplicaSetList,
) []corev1.Pod {
	if podList == nil {
		return nil
	}

	rsUIDs := map[string]struct{}{}
	if replicaSets != nil {
		for _, rs := range replicaSets.Items {
			for _, owner := range rs.OwnerReferences {
				if owner.Controller != nil && *owner.Controller && owner.Kind == "Deployment" && owner.UID == deployment.UID {
					rsUIDs[string(rs.UID)] = struct{}{}
					break
				}
			}
		}
	}

	var filtered []corev1.Pod
	for _, pod := range podList.Items {
		for _, owner := range pod.OwnerReferences {
			if owner.Kind == "ReplicaSet" {
				if _, ok := rsUIDs[string(owner.UID)]; ok {
					filtered = append(filtered, pod)
					break
				}
			}
		}
	}

	return filtered
}

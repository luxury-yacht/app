/*
 * backend/resources/workloads/deployments.go
 *
 * Deployment resource handlers.
 * - Builds detail and list views for the frontend.
 */

package workloads

import (
	"fmt"
	"sort"

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

type DeploymentService struct {
	deps common.Dependencies
}

func NewDeploymentService(deps common.Dependencies) *DeploymentService {
	return &DeploymentService{deps: deps}
}

// Deployment returns the detailed view for a single deployment.
func (s *DeploymentService) Deployment(namespace, name string) (*restypes.DeploymentDetails, error) {
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

func (s *DeploymentService) buildDeploymentDetails(
	deployment *appsv1.Deployment,
	podsList []corev1.Pod,
	podMetrics map[string]*metricsv1beta1.PodMetrics,
	replicaSets *appsv1.ReplicaSetList,
) *restypes.DeploymentDetails {

	model := resourcemodel.BuildDeploymentResourceModel(s.deps.ClusterID, deployment)
	facts := model.Facts.Deployment
	replicas, ready := workloadReplicaDisplay(facts.WorkloadCommonFacts)
	podInfos := buildPodSummaries(s.deps.ClusterID, "Deployment", deployment.Name, "apps/v1", podsList, podMetrics)
	podSummary, _ := summarizePodMetrics(podsList, podMetrics)

	// Live aggregation (not part of the resource's intrinsic definition).
	rsNames, currentRevision, currentRSName := summarizeReplicaSets(deployment, replicaSets)

	// Every intrinsic spec/status field is derived from the model facts — the
	// single extraction point. Only instance metadata and live data are read here.
	details := &restypes.DeploymentDetails{
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
		ResourceUtilization: workloadUtilization(podsList, podMetrics),
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
		Containers:          describeContainers(facts.Containers),
		InitContainers:      describeContainers(facts.InitContainers),
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

func (s *DeploymentService) getDeploymentPods(deployment *appsv1.Deployment) ([]corev1.Pod, map[string]*metricsv1beta1.PodMetrics, *appsv1.ReplicaSetList, error) {
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

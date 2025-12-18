package workloads

import (
	"fmt"
	"sort"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/pods"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
)

// DeploymentService exposes detailed deployment views backed by shared resource dependencies.
type DeploymentService struct {
	deps Dependencies
}

// NewDeploymentService constructs a deployment service using the supplied dependencies bundle.
func NewDeploymentService(deps Dependencies) *DeploymentService {
	return &DeploymentService{deps: deps}
}

// Deployment returns the detailed view for a single deployment.
func (s *DeploymentService) Deployment(namespace, name string) (*restypes.DeploymentDetails, error) {
	client := s.deps.Common.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	deployment, err := client.AppsV1().Deployments(namespace).Get(s.deps.Common.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Common.Logger.Error(fmt.Sprintf("Failed to get deployment %s/%s: %v", namespace, name, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to get deployment: %v", err)
	}

	deploymentPods, podMetrics, err := s.getDeploymentPods(deployment)
	if err != nil {
		s.deps.Common.Logger.Warn(fmt.Sprintf("Failed to collect pods for deployment %s/%s: %v", namespace, name, err), "ResourceLoader")
	}

	replicaSets, err := client.AppsV1().ReplicaSets(namespace).List(s.deps.Common.Context, metav1.ListOptions{LabelSelector: labels.Set(deployment.Spec.Selector.MatchLabels).String()})
	if err != nil {
		replicaSets = nil
	}

	return s.buildDeploymentDetails(deployment, deploymentPods, podMetrics, replicaSets), nil
}

// Deployments returns detailed views for all deployments in the namespace.
func (s *DeploymentService) Deployments(namespace string) ([]*restypes.DeploymentDetails, error) {
	client := s.deps.Common.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	deployments, err := client.AppsV1().Deployments(namespace).List(s.deps.Common.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Common.Logger.Error(fmt.Sprintf("Failed to list deployments in namespace %s: %v", namespace, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to list deployments: %v", err)
	}

	podList, err := client.CoreV1().Pods(namespace).List(s.deps.Common.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Common.Logger.Warn(fmt.Sprintf("Failed to list pods in namespace %s: %v", namespace, err), "ResourceLoader")
	}

	replicaSetList, err := client.AppsV1().ReplicaSets(namespace).List(s.deps.Common.Context, metav1.ListOptions{})
	if err != nil {
		replicaSetList = nil
	}

	podService := pods.NewService(pods.Dependencies{Common: s.deps.Common})
	var metricsByPod map[string]*metricsv1beta1.PodMetrics
	if podList != nil {
		metricsByPod = podService.GetPodMetricsForPods(namespace, podList.Items)
	}

	var results []*restypes.DeploymentDetails
	for i := range deployments.Items {
		deployment := &deployments.Items[i]
		filteredPods := filterPodsForDeployment(deployment, podList, replicaSetList)
		details := s.buildDeploymentDetails(deployment, filteredPods, metricsByPod, replicaSetList)
		results = append(results, details)
	}

	return results, nil
}

func (s *DeploymentService) buildDeploymentDetails(
	deployment *appsv1.Deployment,
	podsList []corev1.Pod,
	podMetrics map[string]*metricsv1beta1.PodMetrics,
	replicaSets *appsv1.ReplicaSetList,
) *restypes.DeploymentDetails {
	avgCPURequest, avgCPULimit, avgMemRequest, avgMemLimit, avgCPUUsage, avgMemUsage := aggregatePodAverages(podsList, podMetrics)

	podInfos := buildPodSummaries("Deployment", deployment.Name, podsList, podMetrics)
	podSummary, _ := summarizePodMetrics(podsList, podMetrics)

	rsNames, currentRevision := summarizeReplicaSets(deployment, replicaSets)
	containers := describeContainers(deployment.Spec.Template.Spec.Containers)
	maxSurge, maxUnavailable := rolloutParameters(deployment)

	revisionHistory := int32(0)
	if deployment.Spec.RevisionHistoryLimit != nil {
		revisionHistory = *deployment.Spec.RevisionHistoryLimit
	}

	progressDeadline := int32(0)
	if deployment.Spec.ProgressDeadlineSeconds != nil {
		progressDeadline = *deployment.Spec.ProgressDeadlineSeconds
	}

	desiredReplicas := int32(0)
	if deployment.Spec.Replicas != nil {
		desiredReplicas = *deployment.Spec.Replicas
	}

	details := &restypes.DeploymentDetails{
		Kind:               "Deployment",
		Name:               deployment.Name,
		Namespace:          deployment.Namespace,
		Replicas:           fmt.Sprintf("%d/%d", deployment.Status.Replicas, desiredReplicas),
		Ready:              fmt.Sprintf("%d/%d", deployment.Status.ReadyReplicas, deployment.Status.Replicas),
		UpToDate:           deployment.Status.UpdatedReplicas,
		Available:          deployment.Status.AvailableReplicas,
		DesiredReplicas:    desiredReplicas,
		Age:                common.FormatAge(deployment.CreationTimestamp.Time),
		CPURequest:         common.FormatCPU(avgCPURequest),
		CPULimit:           common.FormatCPU(avgCPULimit),
		CPUUsage:           common.FormatCPU(avgCPUUsage),
		MemRequest:         common.FormatMemory(avgMemRequest),
		MemLimit:           common.FormatMemory(avgMemLimit),
		MemUsage:           common.FormatMemory(avgMemUsage),
		Strategy:           string(deployment.Spec.Strategy.Type),
		MaxSurge:           maxSurge,
		MaxUnavailable:     maxUnavailable,
		MinReadySeconds:    deployment.Spec.MinReadySeconds,
		RevisionHistory:    revisionHistory,
		ProgressDeadline:   progressDeadline,
		Selector:           deployment.Spec.Selector.MatchLabels,
		Labels:             deployment.Labels,
		Annotations:        deployment.Annotations,
		Containers:         containers,
		Pods:               podInfos,
		CurrentRevision:    currentRevision,
		ReplicaSets:        rsNames,
		ObservedGeneration: deployment.Status.ObservedGeneration,
		Paused:             deployment.Spec.Paused,
	}

	details.Conditions, details.RolloutStatus, details.RolloutMessage = describeDeploymentConditions(deployment)
	details.Details = summarizeDeployment(deployment, desiredReplicas)
	details.PodMetricsSummary = podSummary

	return details
}

func (s *DeploymentService) getDeploymentPods(deployment *appsv1.Deployment) ([]corev1.Pod, map[string]*metricsv1beta1.PodMetrics, error) {
	client := s.deps.Common.KubernetesClient
	if client == nil {
		return nil, nil, fmt.Errorf("kubernetes client not initialized")
	}

	labelSelector := labels.Set(deployment.Spec.Selector.MatchLabels).String()
	podList, err := client.CoreV1().Pods(deployment.Namespace).List(s.deps.Common.Context, metav1.ListOptions{LabelSelector: labelSelector})
	if err != nil {
		return nil, nil, err
	}

	replicaSets, err := client.AppsV1().ReplicaSets(deployment.Namespace).List(s.deps.Common.Context, metav1.ListOptions{LabelSelector: labelSelector})
	if err != nil {
		replicaSets = nil
	}

	filteredPods := filterPodsForDeployment(deployment, podList, replicaSets)
	metrics := pods.NewService(pods.Dependencies{Common: s.deps.Common}).GetPodMetricsForPods(deployment.Namespace, filteredPods)

	return filteredPods, metrics, nil
}

func summarizeReplicaSets(deployment *appsv1.Deployment, replicaSets *appsv1.ReplicaSetList) ([]string, string) {
	if replicaSets == nil {
		return nil, ""
	}

	var names []string
	var currentRevision string

	for _, rs := range replicaSets.Items {
		for _, owner := range rs.OwnerReferences {
			if owner.UID == deployment.UID {
				names = append(names, rs.Name)
				if revision, ok := rs.Annotations["deployment.kubernetes.io/revision"]; ok {
					if deploymentRevision, dok := deployment.Annotations["deployment.kubernetes.io/revision"]; dok && revision == deploymentRevision {
						currentRevision = revision
					}
				}
				break
			}
		}
	}

	sort.Strings(names)
	return names, currentRevision
}

func describeDeploymentConditions(deployment *appsv1.Deployment) ([]string, string, string) {
	conditions := make([]string, 0, len(deployment.Status.Conditions))
	var rolloutStatus, rolloutMessage string

	for _, cond := range deployment.Status.Conditions {
		condStr := fmt.Sprintf("%s: %s", cond.Type, cond.Status)
		if cond.Reason != "" {
			condStr += fmt.Sprintf(" (%s)", cond.Reason)
		}
		if cond.Message != "" {
			condStr += fmt.Sprintf(" - %s", cond.Message)
		}
		conditions = append(conditions, condStr)

		if cond.Type == appsv1.DeploymentProgressing {
			switch cond.Status {
			case corev1.ConditionTrue:
				rolloutStatus = "progressing"
				rolloutMessage = cond.Message
			case corev1.ConditionFalse:
				rolloutStatus = "failed"
				rolloutMessage = cond.Message
			}
		} else if cond.Type == appsv1.DeploymentAvailable && cond.Status == corev1.ConditionTrue && rolloutStatus == "" {
			rolloutStatus = "complete"
		}
	}

	return conditions, rolloutStatus, rolloutMessage
}

func summarizeDeployment(deployment *appsv1.Deployment, desired int32) string {
	summary := fmt.Sprintf("Ready: %d/%d", deployment.Status.ReadyReplicas, desired)
	if deployment.Status.UpdatedReplicas != deployment.Status.Replicas {
		summary += fmt.Sprintf(", Updated: %d", deployment.Status.UpdatedReplicas)
	}
	return summary
}

func rolloutParameters(deployment *appsv1.Deployment) (string, string) {
	var maxSurge, maxUnavailable string
	if deployment.Spec.Strategy.RollingUpdate != nil {
		if deployment.Spec.Strategy.RollingUpdate.MaxSurge != nil {
			maxSurge = deployment.Spec.Strategy.RollingUpdate.MaxSurge.String()
		}
		if deployment.Spec.Strategy.RollingUpdate.MaxUnavailable != nil {
			maxUnavailable = deployment.Spec.Strategy.RollingUpdate.MaxUnavailable.String()
		}
	}
	return maxSurge, maxUnavailable
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

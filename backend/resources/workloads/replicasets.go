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

// ReplicaSetService provides detailed ReplicaSet views backed by shared dependencies.
type ReplicaSetService struct {
	deps Dependencies
}

// NewReplicaSetService constructs a ReplicaSet service using the supplied dependencies bundle.
func NewReplicaSetService(deps Dependencies) *ReplicaSetService {
	return &ReplicaSetService{deps: deps}
}

// ReplicaSet returns the detailed view for a single ReplicaSet.
func (s *ReplicaSetService) ReplicaSet(namespace, name string) (*restypes.ReplicaSetDetails, error) {
	client := s.deps.Common.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	replicaSet, err := client.AppsV1().ReplicaSets(namespace).Get(s.deps.Common.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Common.Logger.Error(fmt.Sprintf("Failed to get ReplicaSet %s/%s: %v", namespace, name, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to get replicaset: %v", err)
	}

	podsForSet, podMetrics, err := s.getReplicaSetPods(replicaSet)
	if err != nil {
		s.deps.Common.Logger.Warn(fmt.Sprintf("Failed to collect pods for ReplicaSet %s/%s: %v", namespace, name, err), "ResourceLoader")
	}

	return s.buildReplicaSetDetails(replicaSet, podsForSet, podMetrics), nil
}

func (s *ReplicaSetService) buildReplicaSetDetails(
	replicaSet *appsv1.ReplicaSet,
	podsList []corev1.Pod,
	podMetrics map[string]*metricsv1beta1.PodMetrics,
) *restypes.ReplicaSetDetails {
	avgCPURequest, avgCPULimit, avgMemRequest, avgMemLimit, avgCPUUsage, avgMemUsage := aggregatePodAverages(podsList, podMetrics)
	podInfos := buildPodSummaries("ReplicaSet", replicaSet.Name, podsList, podMetrics)
	podSummary, _ := summarizePodMetrics(podsList, podMetrics)
	desiredReplicas := int32(0)
	if replicaSet.Spec.Replicas != nil {
		desiredReplicas = *replicaSet.Spec.Replicas
	}

	details := &restypes.ReplicaSetDetails{
		Kind:               "ReplicaSet",
		Name:               replicaSet.Name,
		Namespace:          replicaSet.Namespace,
		Details:            "",
		Replicas:           fmt.Sprintf("%d/%d", replicaSet.Status.Replicas, desiredReplicas),
		Ready:              fmt.Sprintf("%d/%d", replicaSet.Status.ReadyReplicas, replicaSet.Status.Replicas),
		Available:          replicaSet.Status.AvailableReplicas,
		DesiredReplicas:    desiredReplicas,
		Age:                common.FormatAge(replicaSet.CreationTimestamp.Time),
		CPURequest:         common.FormatCPU(avgCPURequest),
		CPULimit:           common.FormatCPU(avgCPULimit),
		CPUUsage:           common.FormatCPU(avgCPUUsage),
		MemRequest:         common.FormatMemory(avgMemRequest),
		MemLimit:           common.FormatMemory(avgMemLimit),
		MemUsage:           common.FormatMemory(avgMemUsage),
		MinReadySeconds:    replicaSet.Spec.MinReadySeconds,
		Selector:           replicaSet.Spec.Selector.MatchLabels,
		Labels:             replicaSet.Labels,
		Annotations:        replicaSet.Annotations,
		Conditions:         describeReplicaSetConditions(replicaSet),
		Containers:         describeContainers(replicaSet.Spec.Template.Spec.Containers),
		Pods:               podInfos,
		PodMetricsSummary:  podSummary,
		ObservedGeneration: replicaSet.Status.ObservedGeneration,
		IsActive:           s.isReplicaSetActive(replicaSet),
	}

	details.Details = summarizeReplicaSet(replicaSet, desiredReplicas)
	return details
}

func (s *ReplicaSetService) getReplicaSetPods(replicaSet *appsv1.ReplicaSet) ([]corev1.Pod, map[string]*metricsv1beta1.PodMetrics, error) {
	client := s.deps.Common.KubernetesClient
	if client == nil {
		return nil, nil, fmt.Errorf("kubernetes client not initialized")
	}

	selector := labels.Set(replicaSet.Spec.Selector.MatchLabels).String()
	podList, err := client.CoreV1().Pods(replicaSet.Namespace).List(s.deps.Common.Context, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return nil, nil, err
	}

	filtered := filterPodsForReplicaSet(replicaSet, podList)
	metrics := pods.NewService(pods.Dependencies{Common: s.deps.Common}).GetPodMetricsForPods(replicaSet.Namespace, filtered)
	return filtered, metrics, nil
}

func (s *ReplicaSetService) isReplicaSetActive(replicaSet *appsv1.ReplicaSet) bool {
	deploymentName := replicaSetDeploymentName(replicaSet)
	if deploymentName == "" {
		return true
	}

	replicaSetRevision := revisionFromAnnotations(replicaSet.Annotations)
	if replicaSetRevision == "" {
		return true
	}

	// Only hide utilization when we can confirm this ReplicaSet is not the active deployment revision.
	client := s.deps.Common.KubernetesClient
	if client == nil {
		return true
	}

	deployment, err := client.AppsV1().Deployments(replicaSet.Namespace).Get(s.deps.Common.Context, deploymentName, metav1.GetOptions{})
	if err != nil {
		s.deps.Common.Logger.Debug(fmt.Sprintf("Failed to fetch deployment %s/%s for ReplicaSet activity: %v", replicaSet.Namespace, deploymentName, err), "ResourceLoader")
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

// describeReplicaSetConditions formats ReplicaSet conditions for display.
func describeReplicaSetConditions(replicaSet *appsv1.ReplicaSet) []string {
	conditions := make([]string, 0, len(replicaSet.Status.Conditions))
	for _, cond := range replicaSet.Status.Conditions {
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

// summarizeReplicaSet builds the short summary string for ReplicaSet details.
func summarizeReplicaSet(replicaSet *appsv1.ReplicaSet, desired int32) string {
	summary := fmt.Sprintf("Ready: %d/%d", replicaSet.Status.ReadyReplicas, desired)
	if replicaSet.Status.AvailableReplicas > 0 {
		summary += fmt.Sprintf(", Available: %d", replicaSet.Status.AvailableReplicas)
	}
	return summary
}

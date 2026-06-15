/*
 * backend/resources/job/details.go
 *
 * Job resource handlers, co-located in the per-kind package. Shared workload
 * helpers live in resources/workloads; intrinsic fields come from the single
 * model (job.Facts).
 */

package job

import (
	"fmt"
	"time"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/pods"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	"github.com/luxury-yacht/app/backend/resources/workloads"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
)

// Service provides detailed Job views backed by shared dependencies.
type Service struct {
	deps common.Dependencies
}

// NewService constructs a Job service using the supplied dependencies bundle.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// Job returns the detailed view for a single job.
func (s *Service) Job(namespace, name string) (*JobDetails, error) {
	client := s.deps.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	job, err := client.BatchV1().Jobs(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get Job %s/%s: %v", namespace, name, err), logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to get job: %v", err)
	}

	podList, err := client.CoreV1().Pods(namespace).List(s.deps.Context, metav1.ListOptions{LabelSelector: metav1.FormatLabelSelector(job.Spec.Selector)})
	if err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to list pods for Job %s/%s: %v", namespace, name, err), logsources.ResourceLoader)
	}

	podsForJob := filterPodsForJob(job, podList)
	metrics := pods.NewService(s.deps).GetPodMetricsForPods(namespace, podsForJob)
	return buildJobDetails(s.deps.ClusterID, job, podsForJob, metrics), nil
}

func buildJobDetails(clusterID string, job *batchv1.Job, podsList []corev1.Pod, podMetrics map[string]*metricsv1beta1.PodMetrics) *JobDetails {
	podSummary, _ := workloads.SummarizePodMetrics(podsList, podMetrics)
	model := BuildResourceModel(clusterID, job)
	facts := BuildFacts(job)

	// All intrinsic spec/status fields come from the model facts (single extraction).
	details := &JobDetails{
		Kind:                    "Job",
		Name:                    job.Name,
		Namespace:               job.Namespace,
		StatusProjection:        restypes.NewStatusProjection(model.Status),
		Age:                     common.FormatAge(job.CreationTimestamp.Time),
		Completions:             facts.DesiredReplicas,
		Parallelism:             facts.Parallelism,
		Succeeded:               facts.Succeeded,
		Failed:                  facts.Failed,
		Active:                  facts.Active,
		StartTime:               facts.StartTime,
		CompletionTime:          facts.CompletionTime,
		CompletionMode:          facts.CompletionMode,
		Suspend:                 facts.Suspended,
		Labels:                  job.Labels,
		Annotations:             job.Annotations,
		Selector:                facts.Selector,
		Containers:              workloads.DescribeContainers(facts.Containers),
		Pods:                    buildSimplePodInfo(clusterID, podsList),
		BackoffLimit:            facts.BackoffLimit,
		ActiveDeadlineSeconds:   facts.ActiveDeadlineSeconds,
		TTLSecondsAfterFinished: facts.TTLSecondsAfterFinished,
		Conditions:              restypes.FormatConditions(facts.Conditions),
	}

	if podSummary != nil {
		details.PodMetricsSummary = podSummary
	}

	// Duration is a display computation over the start/completion facts.
	if details.StartTime != nil {
		if details.CompletionTime != nil {
			duration := details.CompletionTime.Time.Sub(details.StartTime.Time)
			details.Duration = common.FormatAge(time.Now().Add(-duration))
		} else {
			details.Duration = common.FormatAge(details.StartTime.Time)
		}
	}

	details.Details = summarizeJob(details)
	return details
}

func buildSimplePodInfo(clusterID string, podSlice []corev1.Pod) []restypes.PodSimpleInfo {
	if len(podSlice) == 0 {
		return nil
	}

	simple := make([]restypes.PodSimpleInfo, 0, len(podSlice))
	for _, pod := range podSlice {
		simple = append(simple, pods.SummarizePod(clusterID, pod, nil, "Job", podOwnerName(pod), "batch/v1"))
	}
	return simple
}

func podOwnerName(pod corev1.Pod) string {
	for _, owner := range pod.OwnerReferences {
		if owner.Kind == "Job" {
			return owner.Name
		}
	}
	return ""
}

func filterPodsForJob(job *batchv1.Job, podList *corev1.PodList) []corev1.Pod {
	if podList == nil {
		return nil
	}

	var filtered []corev1.Pod
	for _, pod := range podList.Items {
		for _, owner := range pod.OwnerReferences {
			if owner.Controller != nil && *owner.Controller && owner.Kind == "Job" && owner.UID == job.UID {
				filtered = append(filtered, pod)
				break
			}
		}
	}
	return filtered
}

func summarizeJob(details *JobDetails) string {
	summary := fmt.Sprintf("Status: %s, Succeeded: %d/%d", details.Status, details.Succeeded, details.Completions)
	if details.Failed > 0 {
		summary += fmt.Sprintf(", Failed: %d", details.Failed)
	}
	return summary
}

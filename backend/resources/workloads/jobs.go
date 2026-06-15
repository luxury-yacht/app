/*
 * backend/resources/workloads/jobs.go
 *
 * Job resource handlers.
 * - Builds detail and list views for the frontend.
 */

package workloads

import (
	"fmt"
	"time"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/pods"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
)

type JobService struct {
	deps common.Dependencies
}

func NewJobService(deps common.Dependencies) *JobService {
	return &JobService{deps: deps}
}

func (s *JobService) Job(namespace, name string) (*restypes.JobDetails, error) {
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

func buildJobDetails(clusterID string, job *batchv1.Job, podsList []corev1.Pod, podMetrics map[string]*metricsv1beta1.PodMetrics) *restypes.JobDetails {
	podSummary, _ := summarizePodMetrics(podsList, podMetrics)
	model := resourcemodel.BuildJobResourceModel(clusterID, job)
	facts := model.Facts.Job

	// All intrinsic spec/status fields come from the model facts (single extraction).
	details := &restypes.JobDetails{
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
		Containers:              describeContainers(facts.Containers),
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

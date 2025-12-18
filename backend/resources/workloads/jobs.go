package workloads

import (
	"fmt"
	"time"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/pods"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
)

type JobService struct {
	deps Dependencies
}

func NewJobService(deps Dependencies) *JobService {
	return &JobService{deps: deps}
}

func (s *JobService) Job(namespace, name string) (*restypes.JobDetails, error) {
	client := s.deps.Common.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	job, err := client.BatchV1().Jobs(namespace).Get(s.deps.Common.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Common.Logger.Error(fmt.Sprintf("Failed to get Job %s/%s: %v", namespace, name, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to get job: %v", err)
	}

	podList, err := client.CoreV1().Pods(namespace).List(s.deps.Common.Context, metav1.ListOptions{LabelSelector: metav1.FormatLabelSelector(job.Spec.Selector)})
	if err != nil {
		s.deps.Common.Logger.Warn(fmt.Sprintf("Failed to list pods for Job %s/%s: %v", namespace, name, err), "ResourceLoader")
	}

	podsForJob := filterPodsForJob(job, podList)
	metrics := pods.NewService(pods.Dependencies{Common: s.deps.Common}).GetPodMetricsForPods(namespace, podsForJob)
	return buildJobDetails(job, podsForJob, metrics), nil
}

func (s *JobService) Jobs(namespace string) ([]*restypes.JobDetails, error) {
	client := s.deps.Common.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	jobs, err := client.BatchV1().Jobs(namespace).List(s.deps.Common.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Common.Logger.Error(fmt.Sprintf("Failed to list Jobs in namespace %s: %v", namespace, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to list jobs: %v", err)
	}

	podList, err := client.CoreV1().Pods(namespace).List(s.deps.Common.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Common.Logger.Warn(fmt.Sprintf("Failed to list pods in namespace %s: %v", namespace, err), "ResourceLoader")
	}

	podService := pods.NewService(pods.Dependencies{Common: s.deps.Common})
	var results []*restypes.JobDetails
	for i := range jobs.Items {
		job := &jobs.Items[i]
		filtered := filterPodsForJob(job, podList)
		metrics := podService.GetPodMetricsForPods(namespace, filtered)
		results = append(results, buildJobDetails(job, filtered, metrics))
	}

	return results, nil
}

func buildJobDetails(job *batchv1.Job, podsList []corev1.Pod, podMetrics map[string]*metricsv1beta1.PodMetrics) *restypes.JobDetails {
	podSummary, _ := summarizePodMetrics(podsList, podMetrics)
	details := &restypes.JobDetails{
		Kind:                    "Job",
		Name:                    job.Name,
		Namespace:               job.Namespace,
		Age:                     common.FormatAge(job.CreationTimestamp.Time),
		Succeeded:               job.Status.Succeeded,
		Failed:                  job.Status.Failed,
		Active:                  job.Status.Active,
		StartTime:               job.Status.StartTime,
		CompletionTime:          job.Status.CompletionTime,
		Labels:                  job.Labels,
		Annotations:             job.Annotations,
		Selector:                mapStringString(job.Spec.Selector),
		Containers:              describeContainers(job.Spec.Template.Spec.Containers),
		Pods:                    buildSimplePodInfo(podsList),
		BackoffLimit:            defaultInt32(job.Spec.BackoffLimit, 6),
		ActiveDeadlineSeconds:   job.Spec.ActiveDeadlineSeconds,
		TTLSecondsAfterFinished: job.Spec.TTLSecondsAfterFinished,
	}

	if podSummary != nil {
		details.PodMetricsSummary = podSummary
	}

	if job.Spec.Completions != nil {
		details.Completions = *job.Spec.Completions
	} else {
		details.Completions = 1
	}

	if job.Spec.Parallelism != nil {
		details.Parallelism = *job.Spec.Parallelism
	} else {
		details.Parallelism = 1
	}

	if job.Spec.CompletionMode != nil {
		details.CompletionMode = string(*job.Spec.CompletionMode)
	}
	if job.Spec.Suspend != nil {
		details.Suspend = *job.Spec.Suspend
	}

	if details.StartTime != nil {
		if details.CompletionTime != nil {
			duration := details.CompletionTime.Time.Sub(details.StartTime.Time)
			details.Duration = common.FormatAge(time.Now().Add(-duration))
		} else {
			details.Duration = common.FormatAge(details.StartTime.Time)
		}
	}

	switch {
	case details.Failed > 0 && details.BackoffLimit > 0 && details.Failed >= details.BackoffLimit:
		details.Status = "Failed"
	case details.Succeeded >= details.Completions:
		details.Status = "Completed"
	case details.Active > 0:
		details.Status = "Running"
	case details.Suspend:
		details.Status = "Suspended"
	default:
		details.Status = "Pending"
	}

	for _, condition := range job.Status.Conditions {
		cond := fmt.Sprintf("%s: %s", condition.Type, condition.Status)
		if condition.Reason != "" {
			cond += fmt.Sprintf(" (%s)", condition.Reason)
		}
		details.Conditions = append(details.Conditions, cond)
	}

	details.Details = summarizeJob(job, details)
	return details
}

func buildSimplePodInfo(podSlice []corev1.Pod) []restypes.PodSimpleInfo {
	if len(podSlice) == 0 {
		return nil
	}

	simple := make([]restypes.PodSimpleInfo, 0, len(podSlice))
	for _, pod := range podSlice {
		simple = append(simple, restypes.PodSimpleInfo{
			Name:      pod.Name,
			Namespace: pod.Namespace,
			Status:    string(pod.Status.Phase),
			Ready:     pods.PodReadyStatus(pod),
			Restarts:  pods.PodRestartCount(pod),
			Age:       common.FormatAge(pod.CreationTimestamp.Time),
		})
	}
	return simple
}

func mapStringString(selector *metav1.LabelSelector) map[string]string {
	if selector == nil {
		return nil
	}
	return selector.MatchLabels
}

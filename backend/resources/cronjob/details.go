/*
 * backend/resources/cronjob/details.go
 *
 * CronJob resource handlers, co-located in the per-kind package. Shared workload
 * helpers live in resources/workloads; child-Job summaries use the job package
 * (imported as jobres to avoid shadowing the common `job` loop variable).
 */

package cronjob

import (
	"fmt"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resources/common"
	jobres "github.com/luxury-yacht/app/backend/resources/job"
	"github.com/luxury-yacht/app/backend/resources/pods"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	"github.com/luxury-yacht/app/backend/resources/workloads"
	"github.com/robfig/cron/v3"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	k8stypes "k8s.io/apimachinery/pkg/types"
)

// Service provides detailed CronJob views backed by shared dependencies.
type Service struct {
	deps common.Dependencies
}

// NewService constructs a CronJob service using the supplied dependencies bundle.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// CronJob returns the detailed view for a single cronjob.
func (s *Service) CronJob(namespace, name string) (*CronJobDetails, error) {
	client := s.deps.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	cronJob, err := client.BatchV1().CronJobs(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get CronJob %s/%s: %v", namespace, name, err), logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to get cronjob: %v", err)
	}

	jobs, err := client.BatchV1().Jobs(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		jobs = nil
	}

	podInfos, podSummary := s.collectCronJobPods(namespace, cronJob, jobs)
	jobInfos := collectCronJobJobs(s.deps.ClusterID, cronJob, jobs)
	return buildCronJobDetails(s.deps.ClusterID, cronJob, jobs, podInfos, podSummary, jobInfos), nil
}

func buildCronJobDetails(clusterID string, cronJob *batchv1.CronJob, jobs *batchv1.JobList, podInfos []restypes.PodSimpleInfo, podSummary *restypes.PodMetricsSummary, jobInfos []restypes.JobSimpleInfo) *CronJobDetails {
	model := BuildResourceModel(clusterID, cronJob)
	facts := BuildFacts(cronJob)

	// Intrinsic scheduling fields come from the model facts (single extraction).
	// The job-template sub-structure, next-schedule computation, and live job
	// correlation are assembled below (template feeds shared formatters; the rest
	// is display / live data, not the resource's intrinsic definition).
	details := &CronJobDetails{
		Kind:                    "CronJob",
		Name:                    cronJob.Name,
		Namespace:               cronJob.Namespace,
		StatusProjection:        restypes.NewStatusProjection(model.Status),
		Schedule:                facts.Schedule,
		Suspend:                 facts.Suspended,
		LastScheduleTime:        facts.LastScheduleTime,
		LastSuccessfulTime:      facts.LastSuccessfulTime,
		ConcurrencyPolicy:       facts.ConcurrencyPolicy,
		StartingDeadlineSeconds: facts.StartingDeadlineSeconds,
		SuccessfulJobsHistory:   facts.SuccessfulJobsHistory,
		FailedJobsHistory:       facts.FailedJobsHistory,
		Labels:                  cronJob.Labels,
		Annotations:             cronJob.Annotations,
	}

	details.ActiveJobs = describeActiveJobs(cronJob, jobs)
	details.JobTemplate = restypes.JobTemplateDetails{
		Completions:             cronJob.Spec.JobTemplate.Spec.Completions,
		Parallelism:             cronJob.Spec.JobTemplate.Spec.Parallelism,
		BackoffLimit:            cronJob.Spec.JobTemplate.Spec.BackoffLimit,
		ActiveDeadlineSeconds:   cronJob.Spec.JobTemplate.Spec.ActiveDeadlineSeconds,
		TTLSecondsAfterFinished: cronJob.Spec.JobTemplate.Spec.TTLSecondsAfterFinished,
		Containers:              workloads.DescribeContainers(cronJob.Spec.JobTemplate.Spec.Template.Spec.Containers),
	}

	if !details.Suspend {
		details.NextScheduleTime, details.TimeUntilNextSchedule = calculateNextSchedule(cronJob.Spec.Schedule, cronJob.Spec.TimeZone)
	}

	details.LastManualTime, details.LastFailureTime = computeRunMarkers(cronJob, jobs)

	details.Details = summarizeCronJob(details)
	details.Pods = podInfos
	details.PodMetricsSummary = podSummary
	details.Jobs = jobInfos
	return details
}

// computeRunMarkers walks the owned Jobs to find the most recent
// manually-triggered run and the most recent failed run. Both values
// are bounded by the CronJob's history retention — once a Job record
// is GC'd we can no longer report on it, so a nil here means either
// "never" or "older than retention."
func computeRunMarkers(cronJob *batchv1.CronJob, jobs *batchv1.JobList) (*metav1.Time, *metav1.Time) {
	if jobs == nil {
		return nil, nil
	}
	var lastManual, lastFailure *metav1.Time
	for i := range jobs.Items {
		job := &jobs.Items[i]
		if !ownedByCronJob(job.OwnerReferences, cronJob.UID) {
			continue
		}

		// Manually-triggered jobs are tagged by the CronJob controller
		// with `cronjob.kubernetes.io/instantiate: manual`.
		if job.Annotations["cronjob.kubernetes.io/instantiate"] == "manual" {
			start := job.Status.StartTime
			if start == nil {
				t := job.CreationTimestamp
				start = &t
			}
			if lastManual == nil || start.After(lastManual.Time) {
				lastManual = start
			}
		}

		// A Job is "failed" when its backoffLimit is exhausted. Use
		// CompletionTime when present, otherwise the failure-condition
		// timestamp via Conditions, otherwise the Job's StartTime as
		// a coarse fallback.
		if isFailedJob(job) {
			marker := failureTimestamp(job)
			if marker != nil && (lastFailure == nil || marker.After(lastFailure.Time)) {
				lastFailure = marker
			}
		}
	}
	return lastManual, lastFailure
}

func isFailedJob(job *batchv1.Job) bool {
	backoffLimit := defaultInt32(job.Spec.BackoffLimit, 6)
	if job.Status.Failed > 0 && backoffLimit > 0 && job.Status.Failed >= backoffLimit {
		return true
	}
	for _, cond := range job.Status.Conditions {
		if cond.Type == batchv1.JobFailed && cond.Status == corev1.ConditionTrue {
			return true
		}
	}
	return false
}

func failureTimestamp(job *batchv1.Job) *metav1.Time {
	for _, cond := range job.Status.Conditions {
		if cond.Type == batchv1.JobFailed && cond.Status == corev1.ConditionTrue {
			t := cond.LastTransitionTime
			return &t
		}
	}
	if job.Status.CompletionTime != nil {
		return job.Status.CompletionTime
	}
	return job.Status.StartTime
}

func describeActiveJobs(cronJob *batchv1.CronJob, jobs *batchv1.JobList) []restypes.JobReference {
	if len(cronJob.Status.Active) == 0 {
		return nil
	}

	var references []restypes.JobReference
	for _, ref := range cronJob.Status.Active {
		jobRef := restypes.JobReference{Name: ref.Name}
		if jobs != nil {
			for _, job := range jobs.Items {
				if job.Name == ref.Name && job.Namespace == cronJob.Namespace && job.Status.StartTime != nil {
					jobRef.StartTime = job.Status.StartTime
					break
				}
			}
		}
		references = append(references, jobRef)
	}

	return references
}

func (s *Service) collectCronJobPods(namespace string, cronJob *batchv1.CronJob, jobs *batchv1.JobList) ([]restypes.PodSimpleInfo, *restypes.PodMetricsSummary) {
	if jobs == nil {
		return nil, nil
	}
	client := s.deps.KubernetesClient
	if client == nil {
		return nil, nil
	}

	podService := pods.NewService(s.deps)
	rsMap := podService.BuildReplicaSetToDeploymentMap(namespace)

	var collected []corev1.Pod
	seen := make(map[string]struct{})

	for i := range jobs.Items {
		job := &jobs.Items[i]
		if !ownedByCronJob(job.OwnerReferences, cronJob.UID) {
			continue
		}

		options := metav1.ListOptions{}
		if job.Spec.Selector != nil {
			if selector := labels.Set(job.Spec.Selector.MatchLabels).String(); selector != "" {
				options.LabelSelector = selector
			}
		}

		podList, err := client.CoreV1().Pods(namespace).List(s.deps.Context, options)
		if err != nil {
			s.deps.Logger.Debug(fmt.Sprintf("Failed to list pods for job %s/%s: %v", namespace, job.Name, err), logsources.ResourceLoader)
			continue
		}

		for j := range podList.Items {
			pod := podList.Items[j]
			if !ownedByJob(pod, job.UID) {
				continue
			}

			key := pod.Namespace + "/" + pod.Name
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			collected = append(collected, pod)
		}
	}

	if len(collected) == 0 {
		return nil, nil
	}

	metrics := podService.GetPodMetricsForPods(namespace, collected)
	podInfos := make([]restypes.PodSimpleInfo, 0, len(collected))
	for _, pod := range collected {
		ownerKind, ownerName, ownerAPIVersion := pods.ResolveOwner(pod, rsMap)
		podInfos = append(podInfos, pods.SummarizePod(s.deps.ClusterID, pod, metrics, ownerKind, ownerName, ownerAPIVersion))
	}

	podSummary, _ := workloads.SummarizePodMetrics(collected, metrics)
	return podInfos, podSummary
}

// collectCronJobJobs returns summary info for all Jobs owned by the given CronJob.
func collectCronJobJobs(clusterID string, cronJob *batchv1.CronJob, jobs *batchv1.JobList) []restypes.JobSimpleInfo {
	if jobs == nil {
		return nil
	}
	var result []restypes.JobSimpleInfo
	for i := range jobs.Items {
		job := &jobs.Items[i]
		if !ownedByCronJob(job.OwnerReferences, cronJob.UID) {
			continue
		}
		result = append(result, summarizeJobSimple(clusterID, job))
	}
	return result
}

// summarizeJobSimple builds a JobSimpleInfo from a Kubernetes Job object.
func summarizeJobSimple(clusterID string, job *batchv1.Job) restypes.JobSimpleInfo {
	model := jobres.BuildResourceModel(clusterID, job)
	completions := int32(1)
	if job.Spec.Completions != nil {
		completions = *job.Spec.Completions
	}
	ageTimestamp := int64(0)
	if !job.CreationTimestamp.IsZero() {
		ageTimestamp = job.CreationTimestamp.UnixMilli()
	}
	info := restypes.JobSimpleInfo{
		Kind:             "Job",
		Name:             job.Name,
		Namespace:        job.Namespace,
		StatusProjection: restypes.NewStatusProjection(model.Status),
		Completions:      fmt.Sprintf("%d/%d", job.Status.Succeeded, completions),
		Succeeded:        job.Status.Succeeded,
		Failed:           job.Status.Failed,
		Active:           job.Status.Active,
		StartTime:        job.Status.StartTime,
		Age:              common.FormatAge(job.CreationTimestamp.Time),
		AgeTimestamp:     ageTimestamp,
	}

	// Duration: elapsed time from start to completion, or start to now if still running.
	// Also surface in seconds so the frontend can plot bars without parsing
	// the human-readable string back into a number.
	if info.StartTime != nil {
		if job.Status.CompletionTime != nil {
			info.CompletionTime = job.Status.CompletionTime
			duration := job.Status.CompletionTime.Time.Sub(info.StartTime.Time)
			info.Duration = common.FormatAge(time.Now().Add(-duration))
			info.DurationSeconds = int64(duration.Seconds())
		} else {
			info.Duration = common.FormatAge(info.StartTime.Time)
			info.DurationSeconds = int64(time.Since(info.StartTime.Time).Seconds())
		}
	}

	return info
}

func ownedByCronJob(owners []metav1.OwnerReference, cronJobUID k8stypes.UID) bool {
	for _, owner := range owners {
		if owner.Kind == "CronJob" && owner.UID == cronJobUID {
			return true
		}
	}
	return false
}

func ownedByJob(pod corev1.Pod, jobUID k8stypes.UID) bool {
	for _, owner := range pod.OwnerReferences {
		if owner.Kind == "Job" && owner.UID == jobUID {
			return true
		}
	}
	return false
}

func defaultInt32(ptr *int32, fallback int32) int32 {
	if ptr != nil {
		return *ptr
	}
	return fallback
}

func summarizeCronJob(details *CronJobDetails) string {
	summary := fmt.Sprintf("Schedule: %s", details.Schedule)
	if details.Suspend {
		summary += " (suspended)"
	} else if details.LastScheduleTime != nil {
		summary += fmt.Sprintf(", Last: %s ago", common.FormatAge(details.LastScheduleTime.Time))
	}
	return summary
}

// calculateNextSchedule parses the CronJob's schedule expression and returns
// the next firing time as RFC3339 plus a human "in 15m" string. Falls back to
// empty values when the expression is unparseable so the frontend can hide the
// row instead of showing wrong data.
func calculateNextSchedule(schedule string, timeZone *string) (string, string) {
	return calculateNextScheduleAt(schedule, timeZone, time.Now())
}

func calculateNextScheduleAt(schedule string, timeZone *string, now time.Time) (string, string) {
	// k8s CronJob uses the standard 5-field format (no seconds) plus
	// the @yearly/@hourly/@daily descriptors. cron.ParseStandard covers
	// both, matching the kube-controller-manager parser.
	expr, err := cron.ParseStandard(formatCronJobSchedule(schedule, timeZone))
	if err != nil {
		return "", ""
	}
	nextTime := expr.Next(now)
	if nextTime.IsZero() {
		return "", ""
	}
	return nextTime.Format(time.RFC3339), common.FormatAge(time.Now().Add(-nextTime.Sub(now)))
}

func formatCronJobSchedule(schedule string, timeZone *string) string {
	if strings.Contains(schedule, "TZ") {
		return schedule
	}
	if timeZone == nil {
		return schedule
	}
	if _, err := time.LoadLocation(*timeZone); err != nil {
		return schedule
	}
	return fmt.Sprintf("TZ=%s %s", *timeZone, schedule)
}

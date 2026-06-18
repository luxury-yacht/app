/*
 * backend/resources/job/model.go
 *
 * Job resource model: the single definition of a Job's intrinsic fields + status
 * presentation. Detail/object-map projections derive from it.
 */

package job

import (
	"fmt"
	"strconv"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
)

// BuildResourceModel builds the Job resource model. Facts are owned by this
// package (job.Facts); the shared ResourceModel carries identity + status, and
// callers needing facts use BuildFacts.
func BuildResourceModel(clusterID string, job *batchv1.Job) resourcemodel.ResourceModel {
	status := BuildStatusPresentation(job)
	return resourcemodel.WorkloadResourceModel(clusterID, "batch", "v1", "Job", "jobs", job.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts extracts the Job facts from the raw object.
func BuildFacts(job *batchv1.Job) Facts {
	completions := int32(1)
	if job.Spec.Completions != nil {
		completions = *job.Spec.Completions
	}
	parallelism := int32(1)
	if job.Spec.Parallelism != nil {
		parallelism = *job.Spec.Parallelism
	}
	backoffLimit := int32(6)
	if job.Spec.BackoffLimit != nil {
		backoffLimit = *job.Spec.BackoffLimit
	}
	completionMode := ""
	if job.Spec.CompletionMode != nil {
		completionMode = string(*job.Spec.CompletionMode)
	}
	suspended := job.Spec.Suspend != nil && *job.Spec.Suspend
	return Facts{
		PodTemplateFacts:        resourcemodel.BuildPodTemplateFacts(job.Spec.Template),
		DesiredReplicas:         completions,
		Active:                  job.Status.Active,
		Succeeded:               job.Status.Succeeded,
		Failed:                  job.Status.Failed,
		Suspended:               suspended,
		Parallelism:             parallelism,
		BackoffLimit:            backoffLimit,
		ActiveDeadlineSeconds:   job.Spec.ActiveDeadlineSeconds,
		TTLSecondsAfterFinished: job.Spec.TTLSecondsAfterFinished,
		CompletionMode:          completionMode,
		StartTime:               job.Status.StartTime,
		CompletionTime:          job.Status.CompletionTime,
		Selector:                jobSelector(job),
		Conditions:              conditionFacts(job.Status.Conditions),
	}
}

func jobSelector(job *batchv1.Job) map[string]string {
	if job.Spec.Selector == nil {
		return nil
	}
	return job.Spec.Selector.MatchLabels
}

// jobState is the "succeeded/desired" short state string.
func jobState(facts Facts) string {
	return fmt.Sprintf("%d/%d", facts.Succeeded, facts.DesiredReplicas)
}

// BuildStatusPresentation derives the Job status presentation.
func BuildStatusPresentation(job *batchv1.Job) resourcemodel.ResourceStatusPresentation {
	facts := BuildFacts(job)
	signals := jobSignals(job, facts)
	lifecycle := resourcemodel.WorkloadLifecycle(job.ObjectMeta)
	if status, ok := resourcemodel.DeletingWorkloadStatus(job.ObjectMeta, jobState(facts), signals, lifecycle); ok {
		return status
	}
	if failed := findCondition(job, batchv1.JobFailed); failed != nil && failed.Status == corev1.ConditionTrue {
		return resourcemodel.WorkloadConditionStatus(string(batchv1.JobFailed), string(failed.Status), failed.Reason, failed.Message, "Failed", "error", signals, lifecycle)
	}
	if complete := findCondition(job, batchv1.JobComplete); complete != nil && complete.Status == corev1.ConditionTrue {
		return resourcemodel.WorkloadConditionStatus(string(batchv1.JobComplete), string(complete.Status), complete.Reason, complete.Message, "Completed", "ready", signals, lifecycle)
	}
	if facts.Succeeded >= facts.DesiredReplicas && facts.DesiredReplicas > 0 {
		return resourcemodel.WorkloadSourceStatus("Completed", strconv.FormatInt(int64(facts.Succeeded), 10), "", "", "ready", signals, lifecycle)
	}
	if facts.Suspended {
		return resourcemodel.WorkloadSourceStatus("Suspended", "true", "Suspended", "", "warning", signals, lifecycle)
	}
	if facts.Active > 0 {
		return resourcemodel.WorkloadSourceStatus("Running", strconv.FormatInt(int64(facts.Active), 10), "", "", "ready", signals, lifecycle)
	}
	if facts.Failed > 0 {
		return resourcemodel.WorkloadSourceStatus("Failed", strconv.FormatInt(int64(facts.Failed), 10), "", "", "error", signals, lifecycle)
	}
	return resourcemodel.WorkloadSourceStatus("Pending", strconv.FormatInt(int64(facts.Active), 10), "", "", "warning", signals, lifecycle)
}

func jobSignals(job *batchv1.Job, facts Facts) []resourcemodel.ResourceStatusSignal {
	signals := []resourcemodel.ResourceStatusSignal{
		{Type: resourcemodel.StatusSignalResourceState, Name: "spec.completions", Status: strconv.FormatInt(int64(facts.DesiredReplicas), 10)},
		{Type: resourcemodel.StatusSignalResourceState, Name: "status.succeeded", Status: strconv.FormatInt(int64(facts.Succeeded), 10)},
		{Type: resourcemodel.StatusSignalResourceState, Name: "status.failed", Status: strconv.FormatInt(int64(facts.Failed), 10)},
		{Type: resourcemodel.StatusSignalResourceState, Name: "status.active", Status: strconv.FormatInt(int64(facts.Active), 10)},
		{Type: resourcemodel.StatusSignalResourceState, Name: "spec.suspend", Status: strconv.FormatBool(facts.Suspended)},
	}
	for _, condition := range job.Status.Conditions {
		signals = append(signals, resourcemodel.ResourceStatusSignal{
			Type:    resourcemodel.StatusSignalCondition,
			Name:    string(condition.Type),
			Status:  string(condition.Status),
			Reason:  condition.Reason,
			Message: condition.Message,
		})
	}
	return signals
}

func conditionFacts(conditions []batchv1.JobCondition) []resourcemodel.ConditionFacts {
	facts := make([]resourcemodel.ConditionFacts, 0, len(conditions))
	for _, condition := range conditions {
		facts = append(facts, resourcemodel.ConditionFacts{
			Type:    string(condition.Type),
			Status:  string(condition.Status),
			Reason:  condition.Reason,
			Message: condition.Message,
		})
	}
	return facts
}

func findCondition(job *batchv1.Job, conditionType batchv1.JobConditionType) *batchv1.JobCondition {
	for i := range job.Status.Conditions {
		if job.Status.Conditions[i].Type == conditionType {
			return &job.Status.Conditions[i]
		}
	}
	return nil
}

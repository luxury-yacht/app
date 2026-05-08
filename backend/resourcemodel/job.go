package resourcemodel

import (
	"strconv"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
)

func BuildJobResourceModel(clusterID string, job *batchv1.Job) ResourceModel {
	facts := BuildJobFacts(job)
	status := BuildJobStatusPresentation(job)
	return workloadResourceModel(clusterID, "batch", "v1", "Job", "jobs", job.ObjectMeta, status, ResourceFacts{Job: &facts})
}

func BuildJobFacts(job *batchv1.Job) JobFacts {
	completions := int32(1)
	if job.Spec.Completions != nil {
		completions = *job.Spec.Completions
	}
	suspended := job.Spec.Suspend != nil && *job.Spec.Suspend
	return JobFacts{
		DesiredReplicas: completions,
		Active:          job.Status.Active,
		Succeeded:       job.Status.Succeeded,
		Failed:          job.Status.Failed,
		Suspended:       suspended,
		Conditions:      jobConditionFacts(job.Status.Conditions),
	}
}

func BuildJobStatusPresentation(job *batchv1.Job) ResourceStatusPresentation {
	facts := BuildJobFacts(job)
	signals := jobSignals(job, facts)
	lifecycle := workloadLifecycle(job.ObjectMeta)
	if status, ok := deletingWorkloadStatus(job.ObjectMeta, jobState(facts), signals, lifecycle); ok {
		return status
	}
	if failed := findJobCondition(job, batchv1.JobFailed); failed != nil && failed.Status == corev1.ConditionTrue {
		return workloadConditionStatus(string(batchv1.JobFailed), string(failed.Status), failed.Reason, failed.Message, "Failed", "error", signals, lifecycle)
	}
	if complete := findJobCondition(job, batchv1.JobComplete); complete != nil && complete.Status == corev1.ConditionTrue {
		return workloadConditionStatus(string(batchv1.JobComplete), string(complete.Status), complete.Reason, complete.Message, "Completed", "ready", signals, lifecycle)
	}
	if facts.Succeeded >= facts.DesiredReplicas && facts.DesiredReplicas > 0 {
		return workloadSourceStatus("Completed", strconv.FormatInt(int64(facts.Succeeded), 10), "", "", "ready", signals, lifecycle)
	}
	if facts.Suspended {
		return workloadSourceStatus("Suspended", "true", "Suspended", "", "warning", signals, lifecycle)
	}
	if facts.Active > 0 {
		return workloadSourceStatus("Running", strconv.FormatInt(int64(facts.Active), 10), "", "", "ready", signals, lifecycle)
	}
	if facts.Failed > 0 {
		return workloadSourceStatus("Failed", strconv.FormatInt(int64(facts.Failed), 10), "", "", "error", signals, lifecycle)
	}
	return workloadSourceStatus("Pending", strconv.FormatInt(int64(facts.Active), 10), "", "", "warning", signals, lifecycle)
}

func jobSignals(job *batchv1.Job, facts JobFacts) []ResourceStatusSignal {
	signals := []ResourceStatusSignal{
		{Type: StatusSignalResourceState, Name: "spec.completions", Status: strconv.FormatInt(int64(facts.DesiredReplicas), 10)},
		{Type: StatusSignalResourceState, Name: "status.succeeded", Status: strconv.FormatInt(int64(facts.Succeeded), 10)},
		{Type: StatusSignalResourceState, Name: "status.failed", Status: strconv.FormatInt(int64(facts.Failed), 10)},
		{Type: StatusSignalResourceState, Name: "status.active", Status: strconv.FormatInt(int64(facts.Active), 10)},
		{Type: StatusSignalResourceState, Name: "spec.suspend", Status: strconv.FormatBool(facts.Suspended)},
	}
	for _, condition := range job.Status.Conditions {
		signals = append(signals, ResourceStatusSignal{
			Type:    StatusSignalCondition,
			Name:    string(condition.Type),
			Status:  string(condition.Status),
			Reason:  condition.Reason,
			Message: condition.Message,
		})
	}
	return signals
}

func jobConditionFacts(conditions []batchv1.JobCondition) []ConditionFacts {
	facts := make([]ConditionFacts, 0, len(conditions))
	for _, condition := range conditions {
		facts = append(facts, ConditionFacts{
			Type:    string(condition.Type),
			Status:  string(condition.Status),
			Reason:  condition.Reason,
			Message: condition.Message,
		})
	}
	return facts
}

func findJobCondition(job *batchv1.Job, conditionType batchv1.JobConditionType) *batchv1.JobCondition {
	for i := range job.Status.Conditions {
		if job.Status.Conditions[i].Type == conditionType {
			return &job.Status.Conditions[i]
		}
	}
	return nil
}

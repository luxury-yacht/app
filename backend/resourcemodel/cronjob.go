package resourcemodel

import (
	"strconv"

	batchv1 "k8s.io/api/batch/v1"
)

func BuildCronJobResourceModel(clusterID string, cronJob *batchv1.CronJob) ResourceModel {
	facts := BuildCronJobFacts(cronJob)
	status := BuildCronJobStatusPresentation(cronJob)
	return WorkloadResourceModel(clusterID, "batch", "v1", "CronJob", "cronjobs", cronJob.ObjectMeta, status, ResourceFacts{CronJob: &facts})
}

func BuildCronJobFacts(cronJob *batchv1.CronJob) CronJobFacts {
	suspended := cronJob.Spec.Suspend != nil && *cronJob.Spec.Suspend
	successHistory := int32(3)
	if cronJob.Spec.SuccessfulJobsHistoryLimit != nil {
		successHistory = *cronJob.Spec.SuccessfulJobsHistoryLimit
	}
	failHistory := int32(1)
	if cronJob.Spec.FailedJobsHistoryLimit != nil {
		failHistory = *cronJob.Spec.FailedJobsHistoryLimit
	}
	return CronJobFacts{
		Suspended:               suspended,
		ActiveJobs:              int32(len(cronJob.Status.Active)),
		Schedule:                cronJob.Spec.Schedule,
		ConcurrencyPolicy:       string(cronJob.Spec.ConcurrencyPolicy),
		StartingDeadlineSeconds: cronJob.Spec.StartingDeadlineSeconds,
		SuccessfulJobsHistory:   successHistory,
		FailedJobsHistory:       failHistory,
		LastScheduleTime:        cronJob.Status.LastScheduleTime,
		LastSuccessfulTime:      cronJob.Status.LastSuccessfulTime,
	}
}

func BuildCronJobStatusPresentation(cronJob *batchv1.CronJob) ResourceStatusPresentation {
	facts := BuildCronJobFacts(cronJob)
	signals := []ResourceStatusSignal{
		{Type: StatusSignalResourceState, Name: "spec.suspend", Status: strconv.FormatBool(facts.Suspended)},
		{Type: StatusSignalResourceState, Name: "status.active", Status: strconv.FormatInt(int64(facts.ActiveJobs), 10)},
	}
	lifecycle := WorkloadLifecycle(cronJob.ObjectMeta)
	if status, ok := DeletingWorkloadStatus(cronJob.ObjectMeta, strconv.FormatInt(int64(facts.ActiveJobs), 10), signals, lifecycle); ok {
		return status
	}
	if facts.Suspended {
		return workloadSourceStatus("Suspended", "true", "Suspended", "", "warning", signals, lifecycle)
	}
	if facts.ActiveJobs > 0 {
		return workloadSourceStatus("Active", strconv.FormatInt(int64(facts.ActiveJobs), 10), "", "", "ready", signals, lifecycle)
	}
	return workloadSourceStatus("Idle", "0", "", "", "inactive", signals, lifecycle)
}

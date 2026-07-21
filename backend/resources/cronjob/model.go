/*
 * backend/resources/cronjob/model.go
 *
 * CronJob resource model: the single definition of a CronJob's intrinsic fields +
 * status presentation. Detail/object-map projections derive from it.
 */

package cronjob

import (
	"strconv"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	batchv1 "k8s.io/api/batch/v1"
)

// BuildResourceModel builds the CronJob resource model. Facts are owned by this
// package (cronjob.Facts); the shared ResourceModel carries identity + status,
// and callers needing facts use BuildFacts.
func BuildResourceModel(clusterID string, cronJob *batchv1.CronJob) resourcemodel.ResourceModel {
	status := BuildStatusPresentation(cronJob)
	return resourcemodel.KubernetesResourceModel(clusterID, "batch", "v1", "CronJob", "cronjobs", resourcemodel.ResourceScopeNamespaced, cronJob.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts extracts the CronJob facts from the raw object.
func BuildFacts(cronJob *batchv1.CronJob) Facts {
	suspended := cronJob.Spec.Suspend != nil && *cronJob.Spec.Suspend
	successHistory := int32(3)
	if cronJob.Spec.SuccessfulJobsHistoryLimit != nil {
		successHistory = *cronJob.Spec.SuccessfulJobsHistoryLimit
	}
	failHistory := int32(1)
	if cronJob.Spec.FailedJobsHistoryLimit != nil {
		failHistory = *cronJob.Spec.FailedJobsHistoryLimit
	}
	return Facts{
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

// BuildStatusPresentation derives the CronJob status presentation.
func BuildStatusPresentation(cronJob *batchv1.CronJob) resourcemodel.ResourceStatusPresentation {
	facts := BuildFacts(cronJob)
	signals := []resourcemodel.ResourceStatusSignal{
		{Type: resourcemodel.StatusSignalResourceState, Name: "spec.suspend", Status: strconv.FormatBool(facts.Suspended)},
		{Type: resourcemodel.StatusSignalResourceState, Name: "status.active", Status: strconv.FormatInt(int64(facts.ActiveJobs), 10)},
	}
	lifecycle := resourcemodel.ObjectLifecycle(cronJob.ObjectMeta)
	if status, ok := resourcemodel.DeletingObjectStatus(cronJob.ObjectMeta, strconv.FormatInt(int64(facts.ActiveJobs), 10), signals, lifecycle); ok {
		return status
	}
	if facts.Suspended {
		return resourcemodel.ObjectSourceStatus("Suspended", "true", "Suspended", "", "warning", signals, lifecycle)
	}
	if facts.ActiveJobs > 0 {
		return resourcemodel.ObjectSourceStatus("Active", strconv.FormatInt(int64(facts.ActiveJobs), 10), "", "", "ready", signals, lifecycle)
	}
	return resourcemodel.ObjectSourceStatus("Idle", "0", "", "", "inactive", signals, lifecycle)
}

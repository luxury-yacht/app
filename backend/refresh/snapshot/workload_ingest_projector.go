// Workload intake projects immutable own fields, catalog metadata and graph nodes.
// Pod readiness, resources, live metrics and HPA ownership are joined at serving.
package snapshot

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/cronjob"
	"github.com/luxury-yacht/app/backend/resources/daemonset"
	"github.com/luxury-yacht/app/backend/resources/deployment"
	jobres "github.com/luxury-yacht/app/backend/resources/job"
	"github.com/luxury-yacht/app/backend/resources/statefulset"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// Workload GVRs / GVKs are the keys the system wires each bespoke workload reflector
// under (RegisterReflector) and every cut-aware consumer reads the ingest store with.
var (
	DeploymentGVR  = schema.GroupVersionResource{Group: deployment.Identity.Group, Version: deployment.Identity.Version, Resource: deployment.Identity.Resource}
	StatefulSetGVR = schema.GroupVersionResource{Group: statefulset.Identity.Group, Version: statefulset.Identity.Version, Resource: statefulset.Identity.Resource}
	DaemonSetGVR   = schema.GroupVersionResource{Group: daemonset.Identity.Group, Version: daemonset.Identity.Version, Resource: daemonset.Identity.Resource}
	JobGVR         = schema.GroupVersionResource{Group: jobres.Identity.Group, Version: jobres.Identity.Version, Resource: jobres.Identity.Resource}
	CronJobGVR     = schema.GroupVersionResource{Group: cronjob.Identity.Group, Version: cronjob.Identity.Version, Resource: cronjob.Identity.Resource}

	DeploymentGVK  = schema.GroupVersionKind{Group: deployment.Identity.Group, Version: deployment.Identity.Version, Kind: deployment.Identity.Kind}
	StatefulSetGVK = schema.GroupVersionKind{Group: statefulset.Identity.Group, Version: statefulset.Identity.Version, Kind: statefulset.Identity.Kind}
	DaemonSetGVK   = schema.GroupVersionKind{Group: daemonset.Identity.Group, Version: daemonset.Identity.Version, Kind: daemonset.Identity.Kind}
	JobGVK         = schema.GroupVersionKind{Group: jobres.Identity.Group, Version: jobres.Identity.Version, Kind: jobres.Identity.Kind}
	CronJobGVK     = schema.GroupVersionKind{Group: cronjob.Identity.Group, Version: cronjob.Identity.Version, Kind: cronjob.Identity.Kind}
)

// JobControllerOwner is the complete identity of a Job's controlling CronJob,
// retained as the Job bundle's aggregate half so Pod projection can resolve
// Job->CronJob without a second typed Job cache.
type JobControllerOwner struct {
	Job        resourcemodel.ResourceRef
	Controller resourcemodel.ResourceRef
}

func projectJobControllerOwner(meta ClusterMeta, job *batchv1.Job) JobControllerOwner {
	if job == nil {
		return JobControllerOwner{}
	}
	result := JobControllerOwner{Job: resourcemodel.NewResourceRef(resourcemodel.ResourceRef{ClusterID: meta.ClusterID, Group: jobres.Identity.Group, Version: jobres.Identity.Version, Kind: jobres.Identity.Kind, Resource: jobres.Identity.Resource, Namespace: job.Namespace, Name: job.Name, UID: string(job.UID)})}
	for _, owner := range job.OwnerReferences {
		if owner.Controller != nil && *owner.Controller && owner.Kind == cronjob.Identity.Kind && owner.Name != "" {
			gv, err := schema.ParseGroupVersion(owner.APIVersion)
			if err != nil {
				return result
			}
			result.Controller = resourcemodel.NewResourceRef(resourcemodel.ResourceRef{ClusterID: meta.ClusterID, Group: gv.Group, Version: gv.Version, Kind: owner.Kind, Resource: cronjob.Identity.Resource, Namespace: job.Namespace, Name: owner.Name, UID: string(owner.UID)})

			return result
		}
	}
	return result
}

// workloadProjectionError is the typed guard error a workload projector returns when the
// reflector decodes the wrong object type into its store; the ProjectingStore logs it
// once and skips the object, matching the per-kind type guard every projection applies.
type workloadProjectionError string

func (e workloadProjectionError) Error() string { return string(e) }

// NewDeploymentIngestProjector returns the ProjectFunc that projects a reflector-decoded
// Deployment into the three-half Bundle every deployment consumer reads. The Table half is
// workload own fields, with cluster identity stamped from meta.
func NewDeploymentIngestProjector(meta ClusterMeta) ingest.ProjectFunc {
	catalogProject := objectcatalog.SummaryProjector(meta.ClusterID, deployment.Identity)
	nodeProject := objectmapnode.NewNodeProjector(deployment.ObjectMapNode.Status, deployment.ObjectMapNode.ActionFacts, deployment.ObjectMapEdges)
	return func(obj interface{}) (interface{}, error) {
		deploy, ok := obj.(*appsv1.Deployment)
		if !ok {
			return nil, workloadProjectionError("ingest: deployment projector received a non-Deployment object")
		}
		summary := buildDeploymentOwnSummary(meta.ClusterID, deploy)
		var metaObj metav1.Object = deploy
		return ingest.Bundle{
			Table:     summary,
			Catalog:   catalogProject(metaObj),
			ObjectMap: nodeProject(meta.ClusterID, metaObj),
		}, nil
	}
}

// NewStatefulSetIngestProjector mirrors NewDeploymentIngestProjector for StatefulSet.
func NewStatefulSetIngestProjector(meta ClusterMeta) ingest.ProjectFunc {
	catalogProject := objectcatalog.SummaryProjector(meta.ClusterID, statefulset.Identity)
	nodeProject := objectmapnode.NewNodeProjector(statefulset.ObjectMapNode.Status, statefulset.ObjectMapNode.ActionFacts, statefulset.ObjectMapEdges)
	return func(obj interface{}) (interface{}, error) {
		sts, ok := obj.(*appsv1.StatefulSet)
		if !ok {
			return nil, workloadProjectionError("ingest: statefulset projector received a non-StatefulSet object")
		}
		summary := buildStatefulSetOwnSummary(meta.ClusterID, sts)
		var metaObj metav1.Object = sts
		return ingest.Bundle{
			Table:     summary,
			Catalog:   catalogProject(metaObj),
			ObjectMap: nodeProject(meta.ClusterID, metaObj),
		}, nil
	}
}

// NewDaemonSetIngestProjector mirrors NewDeploymentIngestProjector for DaemonSet.
func NewDaemonSetIngestProjector(meta ClusterMeta) ingest.ProjectFunc {
	catalogProject := objectcatalog.SummaryProjector(meta.ClusterID, daemonset.Identity)
	nodeProject := objectmapnode.NewNodeProjector(daemonset.ObjectMapNode.Status, daemonset.ObjectMapNode.ActionFacts, daemonset.ObjectMapEdges)
	return func(obj interface{}) (interface{}, error) {
		ds, ok := obj.(*appsv1.DaemonSet)
		if !ok {
			return nil, workloadProjectionError("ingest: daemonset projector received a non-DaemonSet object")
		}
		summary := buildDaemonSetOwnSummary(meta.ClusterID, ds)
		var metaObj metav1.Object = ds
		return ingest.Bundle{
			Table:     summary,
			Catalog:   catalogProject(metaObj),
			ObjectMap: nodeProject(meta.ClusterID, metaObj),
		}, nil
	}
}

// NewJobIngestProjector mirrors NewDeploymentIngestProjector for Job.
func NewJobIngestProjector(meta ClusterMeta) ingest.ProjectFunc {
	catalogProject := objectcatalog.SummaryProjector(meta.ClusterID, jobres.Identity)
	nodeProject := objectmapnode.NewNodeProjector(jobres.ObjectMapNode.Status, jobres.ObjectMapNode.ActionFacts, jobres.ObjectMapEdges)
	return func(obj interface{}) (interface{}, error) {
		job, ok := obj.(*batchv1.Job)
		if !ok {
			return nil, workloadProjectionError("ingest: job projector received a non-Job object")
		}
		summary := buildJobOwnSummary(meta.ClusterID, job)
		var metaObj metav1.Object = job
		return ingest.Bundle{
			Table:     summary,
			Aggregate: projectJobControllerOwner(meta, job),
			Catalog:   catalogProject(metaObj),
			ObjectMap: nodeProject(meta.ClusterID, metaObj),
		}, nil
	}
}

// NewCronJobIngestProjector mirrors NewDeploymentIngestProjector for CronJob.
func NewCronJobIngestProjector(meta ClusterMeta) ingest.ProjectFunc {
	catalogProject := objectcatalog.SummaryProjector(meta.ClusterID, cronjob.Identity)
	nodeProject := objectmapnode.NewNodeProjector(cronjob.ObjectMapNode.Status, cronjob.ObjectMapNode.ActionFacts, cronjob.ObjectMapEdges)
	return func(obj interface{}) (interface{}, error) {
		cron, ok := obj.(*batchv1.CronJob)
		if !ok {
			return nil, workloadProjectionError("ingest: cronjob projector received a non-CronJob object")
		}
		summary := buildCronJobOwnSummary(meta.ClusterID, cron)
		var metaObj metav1.Object = cron
		return ingest.Bundle{
			Table:     summary,
			Catalog:   catalogProject(metaObj),
			ObjectMap: nodeProject(meta.ClusterID, metaObj),
		}, nil
	}
}

func buildWorkloadOwnSummary(obj metav1.Object, model resourcemodel.ResourceModel, containers []corev1.Container) WorkloadSummary {
	return WorkloadSummary{
		Ref:                model.Ref,
		Metadata:           streamrows.NewResourceMetadata(obj),
		Status:             model.Status.Label,
		StatusState:        model.Status.State,
		StatusPresentation: model.Status.Presentation,
		StatusReason:       model.Status.Reason,
		Age:                formatAge(obj.GetCreationTimestamp().Time),
		AgeTimestamp:       creationTimestampMillis(obj),
		CPUUsage:           "-", CPURequest: "-", CPULimit: "-",
		MemUsage: "-", MemRequest: "-", MemLimit: "-",
		PortForwardAvailable: common.HasForwardableContainerPorts(containers),
	}
}

func buildDeploymentOwnSummary(clusterID string, deploy *appsv1.Deployment) WorkloadSummary {
	summary := buildWorkloadOwnSummary(deploy, deployment.BuildResourceModel(clusterID, deploy), deploy.Spec.Template.Spec.Containers)
	desired := int32(0)
	if deploy.Spec.Replicas != nil {
		desired = *deploy.Spec.Replicas
	}
	summary.Ready = workloadPodReadyStatus(nil, deploy.Status.ReadyReplicas, desired)
	summary.DesiredReplicas = cloneInt32Ptr(deploy.Spec.Replicas)
	return summary
}

func buildStatefulSetOwnSummary(clusterID string, stateful *appsv1.StatefulSet) WorkloadSummary {
	summary := buildWorkloadOwnSummary(stateful, statefulset.BuildResourceModel(clusterID, stateful), stateful.Spec.Template.Spec.Containers)
	desired := int32(0)
	if stateful.Spec.Replicas != nil {
		desired = *stateful.Spec.Replicas
	}
	summary.Ready = workloadPodReadyStatus(nil, stateful.Status.ReadyReplicas, desired)
	summary.DesiredReplicas = cloneInt32Ptr(stateful.Spec.Replicas)
	return summary
}

func buildDaemonSetOwnSummary(clusterID string, daemon *appsv1.DaemonSet) WorkloadSummary {
	summary := buildWorkloadOwnSummary(daemon, daemonset.BuildResourceModel(clusterID, daemon), daemon.Spec.Template.Spec.Containers)
	summary.Ready = workloadPodReadyStatus(nil, daemon.Status.NumberReady, daemon.Status.DesiredNumberScheduled)
	return summary
}

func buildJobOwnSummary(clusterID string, job *batchv1.Job) WorkloadSummary {
	summary := buildWorkloadOwnSummary(job, jobres.BuildResourceModel(clusterID, job), job.Spec.Template.Spec.Containers)
	desired := int32(1)
	if job.Spec.Completions != nil {
		desired = *job.Spec.Completions
	}
	summary.Ready = fmt.Sprintf("%d/%d", job.Status.Succeeded, desired)
	return summary
}

func buildCronJobOwnSummary(clusterID string, cron *batchv1.CronJob) WorkloadSummary {
	summary := buildWorkloadOwnSummary(cron, cronjob.BuildResourceModel(clusterID, cron), cron.Spec.JobTemplate.Spec.Template.Spec.Containers)
	summary.Ready = fmt.Sprintf("%d", len(cron.Status.Active))
	return summary
}

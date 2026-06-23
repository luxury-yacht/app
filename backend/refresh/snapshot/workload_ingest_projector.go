/*
 * backend/refresh/snapshot/workload_ingest_projector.go
 *
 * The workload kinds' owned-reflector ingest projectors. Deployment, StatefulSet,
 * DaemonSet, Job, and CronJob have NO streamspec.Descriptor (the workloads table is the
 * bespoke cross-kind WorkloadSummary, not the generic StreamRow dispatch), so the
 * IngestManager's StreamDescriptors loop never builds them. Each NewXIngestProjector is
 * the bespoke ProjectFunc the system wires onto the manager via RegisterReflector: it
 * projects each reflector-decoded workload into a three-half ingest.Bundle so one intake
 * feeds every workload consumer, and the typed object is then dropped:
 *
 *   - Table     = the workload-OWN-fields WorkloadSummary the namespace-workloads builder
 *                 produces from the typed object alone (NO pods, NO metrics, NO HPA). The
 *                 builder is re-run at serve with the real pod-aggregate join + metrics
 *                 overlay + HPA, so those serve-side joins stay byte-identical;
 *   - Catalog   = the object-catalog Summary (objectcatalog.SummaryProjector);
 *   - ObjectMap = the object-map graph node (objectmapnode.NewNodeProjector from the
 *                 kind's collector status + action facts + edges).
 *
 * The Table half is built by the SAME buildXSummary the serve path calls, invoked with
 * nil pods and nil usage — so the own-fields the reflector projects and the own-fields the
 * serve path computes come from one function, guaranteeing byte-equivalence (proven in
 * workload_ingest_projector_test.go). The metrics + HPA + pod-aggregate join are NOT
 * projected; they are re-joined at serve from the already-cut pod store + LatestPodUsage +
 * the HPA lister, exactly as today.
 */

package snapshot

import (
	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resources/cronjob"
	"github.com/luxury-yacht/app/backend/resources/daemonset"
	"github.com/luxury-yacht/app/backend/resources/deployment"
	jobres "github.com/luxury-yacht/app/backend/resources/job"
	"github.com/luxury-yacht/app/backend/resources/statefulset"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
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

// workloadProjectionError is the typed guard error a workload projector returns when the
// reflector decodes the wrong object type into its store; the ProjectingStore logs it
// once and skips the object, matching the per-kind type guard every projection applies.
type workloadProjectionError string

func (e workloadProjectionError) Error() string { return string(e) }

// NewDeploymentIngestProjector returns the ProjectFunc that projects a reflector-decoded
// Deployment into the three-half Bundle every deployment consumer reads. The Table half is
// the workload-own WorkloadSummary (buildDeploymentSummary with nil pods/usage), with the
// builder's ClusterMeta stamped from meta.
func NewDeploymentIngestProjector(meta ClusterMeta) ingest.ProjectFunc {
	builder := &NamespaceWorkloadsBuilder{}
	catalogProject := objectcatalog.SummaryProjector(meta.ClusterID, meta.ClusterName, deployment.Identity)
	nodeProject := objectmapnode.NewNodeProjector(deployment.ObjectMapNode.Status, deployment.ObjectMapNode.ActionFacts, deployment.ObjectMapEdges)
	return func(obj interface{}) (interface{}, error) {
		deploy, ok := obj.(*appsv1.Deployment)
		if !ok {
			return nil, workloadProjectionError("ingest: deployment projector received a non-Deployment object")
		}
		summary := builder.buildDeploymentSummary(meta.ClusterID, deploy, nil, nil)
		summary.ClusterMeta = meta
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
	builder := &NamespaceWorkloadsBuilder{}
	catalogProject := objectcatalog.SummaryProjector(meta.ClusterID, meta.ClusterName, statefulset.Identity)
	nodeProject := objectmapnode.NewNodeProjector(statefulset.ObjectMapNode.Status, statefulset.ObjectMapNode.ActionFacts, statefulset.ObjectMapEdges)
	return func(obj interface{}) (interface{}, error) {
		sts, ok := obj.(*appsv1.StatefulSet)
		if !ok {
			return nil, workloadProjectionError("ingest: statefulset projector received a non-StatefulSet object")
		}
		summary := builder.buildStatefulSetSummary(meta.ClusterID, sts, nil, nil)
		summary.ClusterMeta = meta
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
	builder := &NamespaceWorkloadsBuilder{}
	catalogProject := objectcatalog.SummaryProjector(meta.ClusterID, meta.ClusterName, daemonset.Identity)
	nodeProject := objectmapnode.NewNodeProjector(daemonset.ObjectMapNode.Status, daemonset.ObjectMapNode.ActionFacts, daemonset.ObjectMapEdges)
	return func(obj interface{}) (interface{}, error) {
		ds, ok := obj.(*appsv1.DaemonSet)
		if !ok {
			return nil, workloadProjectionError("ingest: daemonset projector received a non-DaemonSet object")
		}
		summary := builder.buildDaemonSetSummary(meta.ClusterID, ds, nil, nil)
		summary.ClusterMeta = meta
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
	builder := &NamespaceWorkloadsBuilder{}
	catalogProject := objectcatalog.SummaryProjector(meta.ClusterID, meta.ClusterName, jobres.Identity)
	nodeProject := objectmapnode.NewNodeProjector(jobres.ObjectMapNode.Status, jobres.ObjectMapNode.ActionFacts, jobres.ObjectMapEdges)
	return func(obj interface{}) (interface{}, error) {
		job, ok := obj.(*batchv1.Job)
		if !ok {
			return nil, workloadProjectionError("ingest: job projector received a non-Job object")
		}
		summary := builder.buildJobSummary(meta.ClusterID, job, nil, nil)
		summary.ClusterMeta = meta
		var metaObj metav1.Object = job
		return ingest.Bundle{
			Table:     summary,
			Catalog:   catalogProject(metaObj),
			ObjectMap: nodeProject(meta.ClusterID, metaObj),
		}, nil
	}
}

// NewCronJobIngestProjector mirrors NewDeploymentIngestProjector for CronJob.
func NewCronJobIngestProjector(meta ClusterMeta) ingest.ProjectFunc {
	builder := &NamespaceWorkloadsBuilder{}
	catalogProject := objectcatalog.SummaryProjector(meta.ClusterID, meta.ClusterName, cronjob.Identity)
	nodeProject := objectmapnode.NewNodeProjector(cronjob.ObjectMapNode.Status, cronjob.ObjectMapNode.ActionFacts, cronjob.ObjectMapEdges)
	return func(obj interface{}) (interface{}, error) {
		cron, ok := obj.(*batchv1.CronJob)
		if !ok {
			return nil, workloadProjectionError("ingest: cronjob projector received a non-CronJob object")
		}
		summary := builder.buildCronJobSummary(meta.ClusterID, cron, nil, nil)
		summary.ClusterMeta = meta
		var metaObj metav1.Object = cron
		return ingest.Bundle{
			Table:     summary,
			Catalog:   catalogProject(metaObj),
			ObjectMap: nodeProject(meta.ClusterID, metaObj),
		}, nil
	}
}

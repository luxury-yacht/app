package snapshot

import (
	"strconv"

	"github.com/luxury-yacht/app/backend/refresh/ingest"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// fakeWorkloadIngestSource is a test workloadIngestSource: it projects the supplied typed
// workloads through the SAME per-kind ingest projectors the reflector uses, then serves the
// resulting Bundles keyed by GVR — so a workloads domain unit test feeds the builder exactly
// the projected own-field rows ingest would supply for those workloads. It also serves the
// Catalog half (for the cluster-overview / namespaces counts) and a per-GVR
// resourceVersion + synced flag.
type fakeWorkloadIngestSource struct {
	bundles map[schema.GroupVersionResource][]ingest.Bundle
	rv      map[schema.GroupVersionResource]string
}

func (s fakeWorkloadIngestSource) Rows(gvr schema.GroupVersionResource) []interface{} {
	out := make([]interface{}, 0, len(s.bundles[gvr]))
	for _, b := range s.bundles[gvr] {
		out = append(out, b)
	}
	return out
}

func (s fakeWorkloadIngestSource) CatalogRows(gvr schema.GroupVersionResource) []interface{} {
	out := make([]interface{}, 0, len(s.bundles[gvr]))
	for _, b := range s.bundles[gvr] {
		out = append(out, b.Catalog)
	}
	return out
}

func (s fakeWorkloadIngestSource) StoreResourceVersion(gvr schema.GroupVersionResource) string {
	return s.rv[gvr]
}

func (s fakeWorkloadIngestSource) HasSyncedFor(gvr schema.GroupVersionResource) bool {
	_, ok := s.bundles[gvr]
	return ok
}

// newFakeWorkloadIngestSource projects the supplied typed workloads (any mix of the five
// kinds) to the Bundle each kind's reflector would build, indexed by GVR. The per-GVR
// resourceVersion is the highest typed workload RV, so the workloads version watermark
// matches the prior typed path. meta stamps the projected rows' cluster identity.
func newFakeWorkloadIngestSource(meta ClusterMeta, workloads ...metav1.Object) fakeWorkloadIngestSource {
	src := fakeWorkloadIngestSource{
		bundles: map[schema.GroupVersionResource][]ingest.Bundle{},
		rv:      map[schema.GroupVersionResource]string{},
	}
	deployProj := NewDeploymentIngestProjector(meta)
	stsProj := NewStatefulSetIngestProjector(meta)
	dsProj := NewDaemonSetIngestProjector(meta)
	jobProj := NewJobIngestProjector(meta)
	cronProj := NewCronJobIngestProjector(meta)

	add := func(gvr schema.GroupVersionResource, proj ingest.ProjectFunc, obj metav1.Object) {
		raw, err := proj(obj)
		if err != nil {
			return
		}
		bundle, ok := raw.(ingest.Bundle)
		if !ok {
			return
		}
		src.bundles[gvr] = append(src.bundles[gvr], bundle)
		if rv, err := strconv.ParseUint(obj.GetResourceVersion(), 10, 64); err == nil {
			if cur, _ := strconv.ParseUint(src.rv[gvr], 10, 64); rv > cur {
				src.rv[gvr] = strconv.FormatUint(rv, 10)
			}
		}
	}

	// Ensure every kind's GVR key exists (so HasSyncedFor reports synced for kinds the
	// builder is permitted to read even when the test supplies none of that kind).
	for _, gvr := range []schema.GroupVersionResource{DeploymentGVR, StatefulSetGVR, DaemonSetGVR, JobGVR, CronJobGVR} {
		if _, ok := src.bundles[gvr]; !ok {
			src.bundles[gvr] = nil
		}
	}

	for _, obj := range workloads {
		switch w := obj.(type) {
		case *appsv1.Deployment:
			add(DeploymentGVR, deployProj, w)
		case *appsv1.StatefulSet:
			add(StatefulSetGVR, stsProj, w)
		case *appsv1.DaemonSet:
			add(DaemonSetGVR, dsProj, w)
		case *batchv1.Job:
			add(JobGVR, jobProj, w)
		case *batchv1.CronJob:
			add(CronJobGVR, cronProj, w)
		}
	}
	return src
}

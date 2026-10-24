package snapshot

import (
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
)

// partitionReadinessReporter reports the availability of each partition of an
// ingest source. *ingest.IngestManager satisfies it.
type partitionReadinessReporter interface {
	PartitionReadinessFor(gvr schema.GroupVersionResource) []ingest.PartitionReadiness
}

// ingestRowsComplete reports whether source holds every gvr row in namespace
// ("" = every namespace), so a missing row is an authoritative absence. Every
// partition covering the namespace must report Ready. Settlement is not enough:
// a deadline-degraded store settled without data, and a baseline restored from
// spill reports Unavailable once the permission filter skips its source.
func ingestRowsComplete(source partitionReadinessReporter, gvr schema.GroupVersionResource, namespace string) bool {
	if source == nil {
		return false
	}
	covered := false
	for _, part := range source.PartitionReadinessFor(gvr) {
		if namespace != "" && part.Namespace != "" && part.Namespace != namespace {
			continue
		}
		if part.State != refresh.ResourceReadinessReady {
			return false
		}
		covered = true
	}
	return covered
}

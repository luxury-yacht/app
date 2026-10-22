// Namespace intake keeps the namespace itself, because a namespace row is
// built from the whole object joined at serve with workload presence, warning
// events, and quota pressure. Namespaces are small.
package snapshot

import (
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	namespacepkg "github.com/luxury-yacht/app/backend/resources/namespaces"
)

// NamespaceGVR / NamespaceGVK key the owned namespace reflector.
var (
	NamespaceGVR = namespacepkg.Identity.GVR()
	NamespaceGVK = schema.GroupVersionKind{Group: namespacepkg.Identity.Group, Version: namespacepkg.Identity.Version, Kind: namespacepkg.Identity.Kind}
)

// NewNamespaceIngestProjector returns the ProjectFunc for the owned namespace
// reflector: the namespace (managed fields already stripped) as the Aggregate
// half, and its catalog Summary.
func NewNamespaceIngestProjector(meta ClusterMeta) ingest.ProjectFunc {
	catalogProject := objectcatalog.SummaryProjector(meta.ClusterID, namespacepkg.Identity)
	return func(obj interface{}) (interface{}, error) {
		namespace, ok := obj.(*corev1.Namespace)
		if !ok {
			return nil, workloadProjectionError("ingest: namespace projector received a non-Namespace object")
		}
		return ingest.Bundle{Aggregate: namespace, Catalog: catalogProject(namespace)}, nil
	}
}

// namespaceProvider supplies the cluster's namespaces.
type namespaceProvider interface {
	Namespaces() []*corev1.Namespace
}

// ingestNamespaces reads the namespaces the owned namespace reflector holds.
type ingestNamespaces struct {
	ingest interface {
		AggregateRows(gvr schema.GroupVersionResource) []interface{}
	}
}

func (s ingestNamespaces) Namespaces() []*corev1.Namespace {
	rows := s.ingest.AggregateRows(NamespaceGVR)
	namespaces := make([]*corev1.Namespace, 0, len(rows))
	for _, row := range rows {
		if namespace, ok := row.(*corev1.Namespace); ok {
			namespaces = append(namespaces, namespace)
		}
	}
	return namespaces
}

// namespaceObjectSink rings the namespaces doorbell for every namespace
// change the store applies; a relist is one change. Rows are read from the
// store at serve, so the sink only signals.
type namespaceObjectSink struct {
	notifier *NamespaceChangeNotifier
}

var _ ingest.BundleReplacer = namespaceObjectSink{}

func (s namespaceObjectSink) UpsertBundle(ingest.Bundle)     { s.notifier.NamespaceChanged() }
func (s namespaceObjectSink) DeleteBundle(ingest.Bundle)     { s.notifier.NamespaceChanged() }
func (s namespaceObjectSink) ReplaceBundles([]ingest.Bundle) { s.notifier.NamespaceChanged() }

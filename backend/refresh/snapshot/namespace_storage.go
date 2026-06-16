package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
	corelisters "k8s.io/client-go/listers/core/v1"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	"github.com/luxury-yacht/app/backend/resources/persistentvolumeclaim"
)

const (
	namespaceStorageDomainName       = "namespace-storage"
	errNamespaceStorageScopeRequired = "namespace scope is required"
)

// NamespaceStorageBuilder constructs PVC summaries for a namespace.
type NamespaceStorageBuilder struct {
	pvcLister corelisters.PersistentVolumeClaimLister
}

// NamespaceStorageSnapshot payload for storage tab.
type NamespaceStorageSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows []StorageSummary `json:"rows"`
}

func namespaceStorageQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "namespace", "capacity", "status", "storageClass", "age"},
		[]string{"kinds", "namespaces"},
		[]string{"kind", "name", "namespace", "capacity", "status", "storageClass"},
		[]string{"PersistentVolumeClaim"},
	)
}

// StorageSummary captures PVC info for UI consumption. The type lives in the
// streamrows leaf so the pvc package can build it; this alias keeps the
// snapshot-side name and wire JSON unchanged.
type StorageSummary = streamrows.StorageSummary

// RegisterNamespaceStorageDomain registers the storage domain.
func RegisterNamespaceStorageDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	builder := &NamespaceStorageBuilder{
		pvcLister: factory.Core().V1().PersistentVolumeClaims().Lister(),
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceStorageDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build assembles PVC summaries for the namespace.
func (b *NamespaceStorageBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	baseScope, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), namespaceStorageDomainName, "")
	if err != nil {
		return nil, err
	}
	parsedScope, err := parseNamespaceSnapshotScope(refresh.JoinClusterScope(clusterID, baseScope), errNamespaceStorageScopeRequired)
	if err != nil {
		return nil, err
	}

	pvcs, err := b.listPVCs(parsedScope.Namespace)
	if err != nil {
		return nil, fmt.Errorf("namespace storage: failed to list pvcs: %w", err)
	}

	return b.buildSnapshot(meta, refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed)), query, pvcs)
}

func (b *NamespaceStorageBuilder) listPVCs(namespace string) ([]*corev1.PersistentVolumeClaim, error) {
	if namespace == "" {
		return b.pvcLister.List(labels.Everything())
	}
	return b.pvcLister.PersistentVolumeClaims(namespace).List(labels.Everything())
}

func (b *NamespaceStorageBuilder) buildSnapshot(
	meta ClusterMeta,
	namespace string,
	query typedTableQuery,
	pvcs []*corev1.PersistentVolumeClaim,
) (*refresh.Snapshot, error) {
	resources := make([]StorageSummary, 0, len(pvcs))
	var version uint64

	// The pvc package owns the row builder; the full-snapshot path here and
	// the streaming/incremental path both call it so they cannot drift.
	for _, pvc := range pvcs {
		if pvc == nil {
			continue
		}
		resources = append(resources, persistentvolumeclaim.BuildStreamSummary(meta, pvc))
		if v := resourceVersionOrTimestamp(pvc); v > version {
			version = v
		}
	}

	sort.Slice(resources, func(i, j int) bool {
		if resources[i].Namespace == resources[j].Namespace {
			return resources[i].Name < resources[j].Name
		}
		return resources[i].Namespace < resources[j].Namespace
	})

	resolved := resolveTypedSnapshotPage(
		namespaceStorageDomainName,
		resources,
		query,
		storageTableQueryAdapter(),
		namespaceStorageQueryCapabilities(),
		config.SnapshotNamespaceStorageEntryLimit,
		"storage resources",
		func(resource StorageSummary) string { return resource.Kind },
		nil,
	)
	return &refresh.Snapshot{
		Domain:  namespaceStorageDomainName,
		Scope:   namespace,
		Version: version,
		Payload: NamespaceStorageSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: resolved.Envelope,
			Rows:                  resolved.Rows,
		},
		Stats: resolved.Stats,
	}, nil
}

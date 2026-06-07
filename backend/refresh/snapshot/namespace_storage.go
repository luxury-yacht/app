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
	)
}

// StorageSummary captures PVC info for UI consumption.
type StorageSummary struct {
	ClusterMeta
	Kind               string `json:"kind"`
	Name               string `json:"name"`
	Namespace          string `json:"namespace"`
	Capacity           string `json:"capacity"`
	Status             string `json:"status"`
	StatusState        string `json:"statusState,omitempty"`
	StatusPresentation string `json:"statusPresentation,omitempty"`
	StatusReason       string `json:"statusReason,omitempty"`
	StorageClass       string `json:"storageClass"`
	Age                string `json:"age"`
	AgeTimestamp       int64  `json:"ageTimestamp,omitempty"`
}

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

	// Delegate to the shared row builder so the full-snapshot path and
	// the streaming/incremental update path emit identical row shapes.
	// See BuildPVCStorageSummary in streaming_helpers.go.
	for _, pvc := range pvcs {
		if pvc == nil {
			continue
		}
		resources = append(resources, BuildPVCStorageSummary(meta, pvc))
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

	if query.Enabled {
		page := applyTypedTableQuery(resources, query, storageTableQueryAdapter())
		return &refresh.Snapshot{
			Domain:  namespaceStorageDomainName,
			Scope:   namespace,
			Version: version,
			Payload: NamespaceStorageSnapshot{
				ClusterMeta:           meta,
				ResourceQueryEnvelope: typedQueryEnvelope(namespaceStorageDomainName, page, namespaceStorageQueryCapabilities()),
				Rows:                  page.Rows,
			},
			Stats: refresh.SnapshotStats{ItemCount: len(page.Rows)},
		}, nil
	}

	var totalItems int
	resources, totalItems = truncateSnapshotWindow(resources, config.SnapshotNamespaceStorageEntryLimit)

	return &refresh.Snapshot{
		Domain:  namespaceStorageDomainName,
		Scope:   namespace,
		Version: version,
		Payload: NamespaceStorageSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: typedWindowEnvelope(namespaceStorageDomainName, totalItems, totalItems == len(resources), snapshotSortedKinds(resources, func(resource StorageSummary) string { return resource.Kind }), namespaceStorageQueryCapabilities()),
			Rows:                  resources,
		},
		Stats: snapshotWindowStats(len(resources), totalItems, "storage resources"),
	}, nil
}

func pvcCapacity(pvc *corev1.PersistentVolumeClaim) string {
	if pvc == nil {
		return "-"
	}
	if qty, ok := pvc.Status.Capacity[corev1.ResourceStorage]; ok {
		return qty.String()
	}
	if pvc.Spec.Resources.Requests != nil {
		if qty, ok := pvc.Spec.Resources.Requests[corev1.ResourceStorage]; ok {
			return qty.String()
		}
	}
	return "-"
}

func storageClassName(pvc *corev1.PersistentVolumeClaim) string {
	if pvc == nil {
		return ""
	}
	if pvc.Spec.StorageClassName != nil {
		return *pvc.Spec.StorageClassName
	}
	if pvc.Annotations != nil {
		if value, ok := pvc.Annotations["volume.beta.kubernetes.io/storage-class"]; ok {
			return value
		}
	}
	return ""
}

package snapshot

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
	corelisters "k8s.io/client-go/listers/core/v1"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

const (
	namespaceStorageDomainName       = "namespace-storage"
	namespaceStorageEntryLimit       = 1000
	errNamespaceStorageScopeRequired = "namespace scope is required"
)

// NamespaceStorageBuilder constructs PVC summaries for a namespace.
type NamespaceStorageBuilder struct {
	pvcLister corelisters.PersistentVolumeClaimLister
}

// NamespaceStorageSnapshot payload for storage tab.
type NamespaceStorageSnapshot struct {
	ClusterMeta
	Resources []StorageSummary `json:"resources"`
}

// StorageSummary captures PVC info for UI consumption.
type StorageSummary struct {
	ClusterMeta
	Kind         string `json:"kind"`
	Name         string `json:"name"`
	Namespace    string `json:"namespace"`
	Capacity     string `json:"capacity"`
	Status       string `json:"status"`
	StorageClass string `json:"storageClass"`
	Age          string `json:"age"`
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
	meta := CurrentClusterMeta()
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	trimmed = strings.TrimSpace(trimmed)
	if trimmed == "" {
		return nil, errors.New(errNamespaceStorageScopeRequired)
	}

	isAll := isAllNamespaceScope(trimmed)
	var (
		namespace  string
		err        error
		scopeLabel string
	)
	if isAll {
		scopeLabel = refresh.JoinClusterScope(clusterID, "namespace:all")
	} else {
		namespace, err = parseAutoscalingNamespace(trimmed)
		if err != nil {
			return nil, errors.New(errNamespaceStorageScopeRequired)
		}
		scopeLabel = refresh.JoinClusterScope(clusterID, trimmed)
	}

	pvcs, err := b.listPVCs(namespace)
	if err != nil {
		return nil, fmt.Errorf("namespace storage: failed to list pvcs: %w", err)
	}

	return b.buildSnapshot(meta, scopeLabel, pvcs)
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
	pvcs []*corev1.PersistentVolumeClaim,
) (*refresh.Snapshot, error) {
	resources := make([]StorageSummary, 0, len(pvcs))
	var version uint64

	for _, pvc := range pvcs {
		if pvc == nil {
			continue
		}
		summary := StorageSummary{
			ClusterMeta: meta,
			Kind:         "PersistentVolumeClaim",
			Name:         pvc.Name,
			Namespace:    pvc.Namespace,
			Capacity:     pvcCapacity(pvc),
			Status:       string(pvc.Status.Phase),
			StorageClass: storageClassName(pvc),
			Age:          formatAge(pvc.CreationTimestamp.Time),
		}
		resources = append(resources, summary)
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

	if len(resources) > namespaceStorageEntryLimit {
		resources = resources[:namespaceStorageEntryLimit]
	}

	return &refresh.Snapshot{
		Domain:  namespaceStorageDomainName,
		Scope:   namespace,
		Version: version,
		Payload: NamespaceStorageSnapshot{ClusterMeta: meta, Resources: resources},
		Stats:   refresh.SnapshotStats{ItemCount: len(resources)},
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
